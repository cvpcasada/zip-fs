import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { Readable } from "stream";

import type { ZipHandle, FileHandle, StatsLike, OverlayEntry, EntryMeta } from "./types";
import {
  enoent,
  eisdir,
  enotdir,
  eexist,
} from "./errors";
import { normalizePath } from "./path";
import {
  streamToBuffer,
  openReadStreamFromYauzl,
  promiseFs,
} from "./utils";

export async function open(
  zipPath: string,
  options?: {
    compressOnWrite?: boolean;
    tmpSuffix?: string;
    overlayMode?: "memory" | "disk";
    overlayDir?: string;
    preserveOverlayOnCommit?: boolean;
  }
): Promise<ZipHandle> {
  const compressOnWrite = options?.compressOnWrite ?? false;
  const tmpSuffix = options?.tmpSuffix ?? ".tmp";
  const overlayMode = options?.overlayMode ?? "memory";
  const overlayDir = options?.overlayDir ?? os.tmpdir();
  const preserveOverlayOnCommit = options?.preserveOverlayOnCommit ?? false;

  let zipfile: yauzl.ZipFile | null = null;
  const entries = new Map<string, EntryMeta>();
  const dirs = new Map<string, Set<string>>();
  const overlayFiles = new Map<string, OverlayEntry>();
  const overlayDirs = new Set<string>();
  const deleted = new Set<string>();
  let activeReadStreams = 0;

  // Helper: open and scan zip file if it exists
  async function openAndScanZip(): Promise<void> {
    entries.clear();
    dirs.clear();

    if (!fs.existsSync(zipPath)) {
      zipfile = null;
      return;
    }

    zipfile = await promiseFs<yauzl.ZipFile>((cb) => {
      yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, cb);
    });

    // Build index
    await new Promise<void>((resolve, reject) => {
      zipfile!.on("entry", (entry: yauzl.Entry) => {
        const fileName = entry.fileName;
        const isDirectory = fileName.endsWith("/");

        if (!isDirectory) {
          entries.set(fileName, {
            entry,
            isDirectory: false,
            size: entry.uncompressedSize,
            mtime: entry.getLastModDate(),
            mode: entry.externalFileAttributes
              ? (entry.externalFileAttributes >>> 0) >> 16
              : undefined,
          });
        } else {
          entries.set(fileName.slice(0, -1), {
            entry,
            isDirectory: true,
            size: 0,
            mtime: entry.getLastModDate(),
            mode: entry.externalFileAttributes
              ? (entry.externalFileAttributes >>> 0) >> 16
              : undefined,
          });
        }

        // Build parent directory index
        const parts = fileName.split("/").filter((x) => x);

        // Add root-level entries to root dir
        if (parts.length === 1) {
          if (!dirs.has("")) {
            dirs.set("", new Set());
          }
          const part0 = parts[0];
          if (part0 !== undefined) {
            dirs.get("")!.add(part0);
          }
        }

        // Add to parent directories
        for (let i = 0; i < parts.length - 1; i++) {
          const parentPath = parts.slice(0, i + 1).join("/");
          if (!dirs.has(parentPath)) {
            dirs.set(parentPath, new Set());
          }
          const children = dirs.get(parentPath)!;
          const nextPart = parts[i + 1];
          if (nextPart !== undefined) {
            children.add(nextPart);
          }
        }

        zipfile!.readEntry();
      });

      zipfile!.on("end", () => {
        resolve();
      });

      zipfile!.on("error", reject);

      zipfile!.readEntry();
    });
  }

  // Initial scan
  await openAndScanZip();

  // ========================================================================
  // Helper: ensure parent directories exist in overlay
  // ========================================================================

  function ensureParentDirs(p: string, recursive: boolean): void {
    if (!recursive) return;

    const parts = p.split("/");
    for (let i = 1; i < parts.length - 1; i++) {
      const parentPath = parts.slice(0, i + 1).join("/");
      overlayDirs.add(parentPath);
    }
  }

  // ========================================================================
  // Helper: check if path is deleted or doesn't exist
  // ========================================================================

  function pathExists(p: string): boolean {
    if (deleted.has(p)) return false;
    if (overlayFiles.has(p)) return true;
    if (overlayDirs.has(p)) return true;
    if (entries.has(p)) return true;
    return false;
  }

  function isDirectoryPath(p: string): boolean {
    if (overlayDirs.has(p)) return true;
    const meta = entries.get(p);
    if (meta && meta.isDirectory) return true;

    // Check if any overlay files have this as a parent directory
    for (const filePath of overlayFiles.keys()) {
      if (!deleted.has(filePath)) {
        const parts = filePath.split("/");
        for (let i = 1; i < parts.length; i++) {
          const parentPath = parts.slice(0, i).join("/");
          if (parentPath === p) return true;
        }
      }
    }

    return false;
  }

  // ========================================================================
  // Exported Methods
  // ========================================================================

  async function stat(p: string): Promise<StatsLike> {
    const normalized = p === "" ? "" : normalizePath(p);

    // Check overlay
    if (overlayFiles.has(normalized)) {
      const entry = overlayFiles.get(normalized)!;
      const size = entry.kind === "memory" ? entry.data.length : entry.size;
      return {
        isFile() {
          return true;
        },
        isDirectory() {
          return false;
        },
        size,
        mtime: entry.mtime,
        mtimeMs: entry.mtime.getTime(),
        mode: entry.mode,
      };
    }

    if (overlayDirs.has(normalized)) {
      return {
        isFile() {
          return false;
        },
        isDirectory() {
          return true;
        },
        size: 0,
        mtime: new Date(),
        mtimeMs: Date.now(),
      };
    }

    // Check deleted
    if (deleted.has(normalized)) {
      throw enoent(normalized);
    }

    // Check base
    const meta = entries.get(normalized);
    if (meta) {
      return {
        isFile() {
          return !meta.isDirectory;
        },
        isDirectory() {
          return meta.isDirectory;
        },
        size: meta.size,
        mtime: meta.mtime,
        mtimeMs: meta.mtime.getTime(),
        mode: meta.mode,
      };
    }

    // Check if it's an implicit directory from overlay files
    if (isDirectoryPath(normalized)) {
      return {
        isFile() {
          return false;
        },
        isDirectory() {
          return true;
        },
        size: 0,
        mtime: new Date(),
        mtimeMs: Date.now(),
      };
    }

    throw enoent(normalized);
  }

  async function readFile(
    p: string,
    enc?: BufferEncoding
  ): Promise<Buffer | string> {
    const normalized = normalizePath(p);

    // Check overlay
    if (overlayFiles.has(normalized)) {
      const entry = overlayFiles.get(normalized)!;
      const buf =
        entry.kind === "memory"
          ? entry.data
          : await fs.promises.readFile(entry.absPath);
      return enc ? buf.toString(enc) : buf;
    }

    // Check if it's a directory in overlay
    if (overlayDirs.has(normalized)) {
      throw eisdir(normalized);
    }

    // Check deleted or directory
    if (deleted.has(normalized)) {
      throw enoent(normalized);
    }

    // Check if it's an implicit directory from nested overlay files
    if (isDirectoryPath(normalized)) {
      throw eisdir(normalized);
    }

    const meta = entries.get(normalized);
    if (!meta) {
      throw enoent(normalized);
    }
    if (meta.isDirectory) {
      throw eisdir(normalized);
    }

    if (!zipfile) {
      throw enoent(normalized);
    }

    const stream = await openReadStreamFromYauzl(zipfile, meta.entry);
    const buf = await streamToBuffer(stream);
    return enc ? buf.toString(enc) : buf;
  }

  async function readdir(p: string): Promise<string[]> {
    const normalized = p === "" ? "" : normalizePath(p);

    // Validate path exists and is directory
    if (deleted.has(normalized)) {
      throw enoent(normalized);
    }

    const meta = entries.get(normalized);
    const inOverlayDirs = overlayDirs.has(normalized);
    const inOverlayFiles = overlayFiles.has(normalized);
    const isDir = isDirectoryPath(normalized);

    // Path must be a directory or the root
    if (!isDir && normalized !== "") {
      // Check if it's actually a file (ENOTDIR) or doesn't exist (ENOENT)
      if (inOverlayFiles) {
        throw enotdir(normalized);
      } else if (meta && !meta.isDirectory) {
        throw enotdir(normalized);
      } else if (!meta && !inOverlayDirs && !isDir) {
        throw enoent(normalized);
      }
    }

    const children = new Set<string>();

    // Add from base dirs
    const baseDirChildren = dirs.get(normalized);
    if (baseDirChildren) {
      baseDirChildren.forEach((child) => children.add(child));
    }

    // Add from overlay (files and dirs)
    overlayFiles.forEach((_, filePath) => {
      if (!deleted.has(filePath)) {
        const parts = filePath.split("/");
        if (parts.length > 1 && parts.slice(0, -1).join("/") === normalized) {
          const lastPart = parts[parts.length - 1];
          if (lastPart !== undefined) {
            children.add(lastPart);
          }
        } else if (normalized === "" && parts.length === 1) {
          // Root level files
          children.add(filePath);
        }
      }
    });

    overlayDirs.forEach((dirPath) => {
      const parts = dirPath.split("/");
      if (parts.length > 1 && parts.slice(0, -1).join("/") === normalized) {
        const lastPart = parts[parts.length - 1];
        if (lastPart !== undefined) {
          children.add(lastPart);
        }
      } else if (normalized === "" && parts.length === 1) {
        // Root level dirs
        children.add(dirPath);
      }
    });

    return Array.from(children).sort();
  }

  function createReadStream(p: string): Readable {
    const normalized = normalizePath(p);

    return new Readable({
      async read() {
        try {
          // Check overlay first
          if (overlayFiles.has(normalized)) {
            const entry = overlayFiles.get(normalized)!;
            if (entry.kind === "memory") {
              this.push(entry.data);
              this.push(null);
            } else {
              // For disk entries, create a stream and pipe it
              const diskStream = fs.createReadStream(entry.absPath);
              diskStream.on("data", (chunk) => {
                this.push(chunk);
              });
              diskStream.on("end", () => {
                this.push(null);
              });
              diskStream.on("error", (err) => {
                this.destroy(err);
              });
            }
            return;
          }

          // Check deleted
          if (deleted.has(normalized)) {
            this.destroy(enoent(normalized));
            return;
          }

          // Check base
          const meta = entries.get(normalized);
          if (!meta || meta.isDirectory) {
            this.destroy(enoent(normalized));
            return;
          }

          if (!zipfile) {
            this.destroy(enoent(normalized));
            return;
          }

          activeReadStreams++;
          const baseStream = await openReadStreamFromYauzl(zipfile, meta.entry);

          baseStream.on("data", (chunk) => {
            this.push(chunk);
          });

          baseStream.on("end", () => {
            activeReadStreams--;
            this.push(null);
          });

          baseStream.on("error", (err) => {
            activeReadStreams--;
            this.destroy(err);
          });
        } catch (err) {
          this.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });
  }

  function openFile(p: string): FileHandle {
    return {
      createReadStream() {
        return createReadStream(p);
      },
    };
  }

  async function writeFile(
    p: string,
    data: Buffer | string,
    opts?: { mode?: number; mtime?: Date; encoding?: BufferEncoding }
  ): Promise<void> {
    const normalized = normalizePath(p);

    const buf =
      typeof data === "string"
        ? Buffer.from(data, opts?.encoding ?? "utf8")
        : data;
    const mtime = opts?.mtime ?? new Date();

    // Automatically create parent directories
    ensureParentDirs(normalized, true);

    if (overlayMode === "memory") {
      overlayFiles.set(normalized, {
        kind: "memory",
        data: buf,
        mtime,
        mode: opts?.mode,
      });
    } else {
      // disk mode
      const overlayFilePath = path.join(
        overlayDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await fs.promises.mkdir(path.dirname(overlayFilePath), {
        recursive: true,
      });
      await fs.promises.writeFile(overlayFilePath, buf);

      overlayFiles.set(normalized, {
        kind: "disk",
        absPath: overlayFilePath,
        size: buf.length,
        mtime,
        mode: opts?.mode,
      });
    }

    deleted.delete(normalized);
  }

  async function mkdir(
    p: string,
    opts?: { recursive?: boolean }
  ): Promise<void> {
    const normalized = normalizePath(p);

    if (deleted.has(normalized)) {
      deleted.delete(normalized);
    }

    if (overlayDirs.has(normalized)) {
      if (!opts?.recursive) {
        throw eexist(normalized);
      }
      return;
    }

    const meta = entries.get(normalized);
    if (meta) {
      if (!opts?.recursive) {
        throw eexist(normalized);
      }
      return;
    }

    if (opts?.recursive) {
      ensureParentDirs(normalized, true);
    } else {
      const parts = normalized.split("/");
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join("/");
        if (!pathExists(parentPath) && !isDirectoryPath(parentPath)) {
          throw enoent(parentPath);
        }
      }
    }

    overlayDirs.add(normalized);
  }

  async function unlink(p: string): Promise<void> {
    const normalized = normalizePath(p);

    if (deleted.has(normalized)) {
      throw enoent(normalized);
    }

    // Check if it's a directory in overlay
    if (overlayDirs.has(normalized)) {
      throw eisdir(normalized);
    }

    // Check if it's an implicit directory from nested overlay files
    if (isDirectoryPath(normalized)) {
      throw eisdir(normalized);
    }

    // Check if it's a file in overlay
    if (overlayFiles.has(normalized)) {
      const entry = overlayFiles.get(normalized)!;
      if (entry.kind === "disk") {
        try {
          await fs.promises.unlink(entry.absPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      overlayFiles.delete(normalized);
      return;
    }

    // Check if it's in base
    const meta = entries.get(normalized);
    if (!meta) {
      throw enoent(normalized);
    }

    if (meta.isDirectory) {
      throw eisdir(normalized);
    }

    deleted.add(normalized);
  }

  async function commit(): Promise<void> {
    if (activeReadStreams > 0) {
      throw new Error(
        `Cannot commit while ${activeReadStreams} read streams are active`
      );
    }

    // Create new yazl ZipFile
    const newZipfile = new yazl.ZipFile();
    const tmpPath = zipPath + tmpSuffix;

    // Add overlay files
    for (const [filePath, entry] of overlayFiles.entries()) {
      if (deleted.has(filePath)) continue;

      const options: Partial<yazl.Options> = {
        mtime: entry.mtime,
        compress: compressOnWrite,
      };
      if (entry.mode !== undefined) {
        options.mode = entry.mode;
      }

      if (entry.kind === "memory") {
        newZipfile.addBuffer(entry.data, filePath, options);
      } else {
        newZipfile.addFile(entry.absPath, filePath, options);
      }
    }

    // Add base files (not deleted, not overwritten)
    for (const [basePath, meta] of entries.entries()) {
      if (deleted.has(basePath) || overlayFiles.has(basePath)) continue;

      if (!meta.isDirectory) {
        if (!zipfile) continue;

        const options: Partial<yazl.ReadStreamOptions> = {
          mtime: meta.mtime,
          compress: compressOnWrite,
        };
        if (meta.mode !== undefined) {
          options.mode = meta.mode & 0xffff;
        }

        newZipfile.addReadStreamLazy(
          basePath,
          options,
          (cb: (err: any, readStream: NodeJS.ReadableStream) => void) => {
            zipfile!.openReadStream(meta.entry, cb);
          }
        );
      }
    }

    // Add explicit empty directories
    for (const dirPath of overlayDirs.values()) {
      if (!deleted.has(dirPath)) {
        newZipfile.addEmptyDirectory(dirPath, {
          mtime: new Date(),
        });
      }
    }

    // Write to temp file and atomically rename
    await new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(tmpPath);

      writeStream.on("close", async () => {
        try {
          // Atomic rename
          await fs.promises.rename(tmpPath, zipPath);
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      writeStream.on("error", reject);
      newZipfile.outputStream.pipe(writeStream);
      newZipfile.end();
    });

    // Close old zipfile
    if (zipfile) {
      zipfile.close();
    }

    // Reopen and rescan
    await openAndScanZip();

    // Clear overlay
    if (!preserveOverlayOnCommit) {
      overlayFiles.clear();
      overlayDirs.clear();
      deleted.clear();

      // Cleanup disk overlay files
      if (overlayMode === "disk") {
        // Files are already deleted from overlayFiles, so nothing to clean up
      }
    }
  }

  async function close(): Promise<void> {
    if (zipfile) {
      zipfile.close();
      zipfile = null;
    }

    // Clean up disk overlay files if in disk mode
    if (overlayMode === "disk") {
      for (const [, entry] of overlayFiles.entries()) {
        if (entry.kind === "disk") {
          try {
            await fs.promises.unlink(entry.absPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }
  }

  return {
    stat,
    readFile,
    readdir,
    createReadStream,
    open: openFile,
    writeFile,
    mkdir,
    unlink,
    commit,
    close,
  };
}
