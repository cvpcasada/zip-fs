import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { Readable } from "node:stream";

import type { StatsLike, OverlayEntry, EntryMeta } from "./types";
import { enoent, eisdir, enotdir, eexist } from "./errors";
import { normalizePath } from "./path";
import { streamToBuffer, promisify } from "./utils";

export class ZipFS {
  private zipPath: string;
  private compressOnWrite: boolean;
  private tmpSuffix: string;
  private overlayMode: "memory" | "disk";
  private overlayDir: string;
  private preserveOverlayOnCommit: boolean;

  private zipfile: yauzl.ZipFile | null = null;
  private entries = new Map<string, EntryMeta>();
  private dirs = new Map<string, Set<string>>();
  private overlayFiles = new Map<string, OverlayEntry>();
  private overlayDirs = new Set<string>();
  private deleted = new Set<string>();
  private activeReadStreams = 0;

  constructor(
    zipPath: string,
    options?: {
      compressOnWrite?: boolean;
      tmpSuffix?: string;
      overlayMode?: "memory" | "disk";
      overlayDir?: string;
      preserveOverlayOnCommit?: boolean;
    }
  ) {
    this.zipPath = zipPath;
    this.compressOnWrite = options?.compressOnWrite ?? false;
    this.tmpSuffix = options?.tmpSuffix ?? ".tmp";
    this.overlayMode = options?.overlayMode ?? "memory";
    this.overlayDir = options?.overlayDir ?? os.tmpdir();
    this.preserveOverlayOnCommit = options?.preserveOverlayOnCommit ?? false;
  }

  // Helper: open and scan zip file if it exists
  private async buildEntries(): Promise<void> {
    this.entries.clear();
    this.dirs.clear();

    if (!fs.existsSync(this.zipPath)) {
      this.zipfile = null;
      return;
    }

    this.zipfile = await promisify<yauzl.ZipFile>((cb) => {
      yauzl.open(
        this.zipPath,
        {
          lazyEntries: true,
          autoClose: false,
        },
        cb
      );
    });

    // Build index
    await new Promise<void>((resolve, reject) => {
      this.zipfile!.on("entry", (entry: yauzl.Entry) => {
        const fileName = entry.fileName;
        const isDirectory = fileName.endsWith("/");

        if (!isDirectory) {
          this.entries.set(fileName, {
            entry,
            isDirectory: false,
            size: entry.uncompressedSize,
            mtime: entry.getLastModDate(),
            mode: entry.externalFileAttributes
              ? (entry.externalFileAttributes >>> 0) >> 16
              : undefined,
          });
        } else {
          this.entries.set(fileName.slice(0, -1), {
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
          if (!this.dirs.has("")) {
            this.dirs.set("", new Set());
          }
          const part0 = parts[0];
          if (part0 !== undefined) {
            this.dirs.get("")!.add(part0);
          }
        }

        // Add to parent directories
        for (let i = 0; i < parts.length - 1; i++) {
          const parentPath = parts.slice(0, i + 1).join("/");
          if (!this.dirs.has(parentPath)) {
            this.dirs.set(parentPath, new Set());
          }
          const children = this.dirs.get(parentPath)!;
          const nextPart = parts[i + 1];
          if (nextPart !== undefined) {
            children.add(nextPart);
          }
        }

        this.zipfile!.readEntry();
      });

      this.zipfile!.on("end", () => {
        resolve();
      });

      this.zipfile!.on("error", reject);

      this.zipfile!.readEntry();
    });
  }

  // ========================================================================
  // Helper: ensure parent directories exist in overlay
  // ========================================================================

  private ensureParentDirs(p: string, recursive: boolean): void {
    if (!recursive) return;

    const parts = p.split("/");
    for (let i = 1; i < parts.length - 1; i++) {
      const parentPath = parts.slice(0, i + 1).join("/");
      this.overlayDirs.add(parentPath);
    }
  }

  // ========================================================================
  // Helper: check if path is deleted or doesn't exist
  // ========================================================================

  private pathExists(p: string): boolean {
    if (this.deleted.has(p)) return false;
    if (this.overlayFiles.has(p)) return true;
    if (this.overlayDirs.has(p)) return true;
    if (this.entries.has(p)) return true;
    return false;
  }

  private isDirectoryPath(p: string): boolean {
    if (this.overlayDirs.has(p)) return true;
    const meta = this.entries.get(p);
    if (meta && meta.isDirectory) return true;

    // Check if any overlay files have this as a parent directory
    for (const filePath of this.overlayFiles.keys()) {
      if (!this.deleted.has(filePath)) {
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

  async stat(p: string): Promise<StatsLike> {
    const normalized = p === "" ? "" : normalizePath(p);

    // Check overlay
    if (this.overlayFiles.has(normalized)) {
      const entry = this.overlayFiles.get(normalized)!;
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

    if (this.overlayDirs.has(normalized)) {
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
    if (this.deleted.has(normalized)) {
      throw enoent(normalized);
    }

    // Check base
    const meta = this.entries.get(normalized);
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
    if (this.isDirectoryPath(normalized)) {
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

  async readFile(p: string, enc?: BufferEncoding): Promise<Buffer | string> {
    const normalized = normalizePath(p);

    // Check overlay
    if (this.overlayFiles.has(normalized)) {
      const entry = this.overlayFiles.get(normalized)!;
      const buf =
        entry.kind === "memory"
          ? entry.data
          : await fs.promises.readFile(entry.absPath);
      return enc ? buf.toString(enc) : buf;
    }

    // Check if it's a directory in overlay
    if (this.overlayDirs.has(normalized)) {
      throw eisdir(normalized);
    }

    // Check deleted or directory
    if (this.deleted.has(normalized)) {
      throw enoent(normalized);
    }

    // Check if it's an implicit directory from nested overlay files
    if (this.isDirectoryPath(normalized)) {
      throw eisdir(normalized);
    }

    const meta = this.entries.get(normalized);
    if (!meta) {
      throw enoent(normalized);
    }
    if (meta.isDirectory) {
      throw eisdir(normalized);
    }

    if (!this.zipfile) {
      throw enoent(normalized);
    }

    const stream = await promisify<Readable>((cb) =>
      this.zipfile!.openReadStream(meta.entry, cb)
    );

    const buf = await streamToBuffer(stream);
    return enc ? buf.toString(enc) : buf;
  }

  async readdir(p: string): Promise<string[]> {
    const normalized = p === "" ? "" : normalizePath(p);

    // Validate path exists and is directory
    if (this.deleted.has(normalized)) {
      throw enoent(normalized);
    }

    const meta = this.entries.get(normalized);
    const inOverlayDirs = this.overlayDirs.has(normalized);
    const inOverlayFiles = this.overlayFiles.has(normalized);
    const isDir = this.isDirectoryPath(normalized);

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
    const baseDirChildren = this.dirs.get(normalized);
    if (baseDirChildren) {
      baseDirChildren.forEach((child) => children.add(child));
    }

    // Add from overlay (files and dirs)
    this.overlayFiles.forEach((_, filePath) => {
      if (!this.deleted.has(filePath)) {
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

    this.overlayDirs.forEach((dirPath) => {
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

  createReadStream(p: string): Readable {
    const normalized = normalizePath(p);
    const self = this;

    return new Readable({
      read: async function () {
        try {
          // Check overlay first
          if (self.overlayFiles.has(normalized)) {
            const entry = self.overlayFiles.get(normalized)!;
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
          if (self.deleted.has(normalized)) {
            this.destroy(enoent(normalized));
            return;
          }

          // Check base
          const meta = self.entries.get(normalized);
          if (!meta || meta.isDirectory) {
            this.destroy(enoent(normalized));
            return;
          }

          if (!self.zipfile) {
            this.destroy(enoent(normalized));
            return;
          }

          self.activeReadStreams++;
          const baseStream = await promisify<Readable>((cb) =>
            self.zipfile!.openReadStream(meta.entry, cb)
          );

          baseStream.on("data", (chunk) => {
            this.push(chunk);
          });

          baseStream.on("end", () => {
            self.activeReadStreams--;
            this.push(null);
          });

          baseStream.on("error", (err) => {
            self.activeReadStreams--;
            this.destroy(err);
          });
        } catch (err) {
          this.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });
  }

  async writeFile(
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
    this.ensureParentDirs(normalized, true);

    if (this.overlayMode === "memory") {
      this.overlayFiles.set(normalized, {
        kind: "memory",
        data: buf,
        mtime,
        mode: opts?.mode,
      });
    } else {
      // disk mode
      const overlayFilePath = path.join(
        this.overlayDir,
        `${Date.now()}-${Math.random().toString(36).slice(2)}`
      );
      await fs.promises.mkdir(path.dirname(overlayFilePath), {
        recursive: true,
      });
      await fs.promises.writeFile(overlayFilePath, buf);

      this.overlayFiles.set(normalized, {
        kind: "disk",
        absPath: overlayFilePath,
        size: buf.length,
        mtime,
        mode: opts?.mode,
      });
    }

    this.deleted.delete(normalized);
  }

  async mkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
    const normalized = normalizePath(p);

    if (this.deleted.has(normalized)) {
      this.deleted.delete(normalized);
    }

    if (this.overlayDirs.has(normalized)) {
      if (!opts?.recursive) {
        throw eexist(normalized);
      }
      return;
    }

    const meta = this.entries.get(normalized);
    if (meta) {
      if (!opts?.recursive) {
        throw eexist(normalized);
      }
      return;
    }

    if (opts?.recursive) {
      this.ensureParentDirs(normalized, true);
    } else {
      const parts = normalized.split("/");
      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join("/");
        if (!this.pathExists(parentPath) && !this.isDirectoryPath(parentPath)) {
          throw enoent(parentPath);
        }
      }
    }

    this.overlayDirs.add(normalized);
  }

  async unlink(p: string): Promise<void> {
    const normalized = normalizePath(p);

    if (this.deleted.has(normalized)) {
      throw enoent(normalized);
    }

    // Check if it's a directory in overlay
    if (this.overlayDirs.has(normalized)) {
      throw eisdir(normalized);
    }

    // Check if it's an implicit directory from nested overlay files
    if (this.isDirectoryPath(normalized)) {
      throw eisdir(normalized);
    }

    // Check if it's a file in overlay
    if (this.overlayFiles.has(normalized)) {
      const entry = this.overlayFiles.get(normalized)!;
      if (entry.kind === "disk") {
        try {
          await fs.promises.unlink(entry.absPath);
        } catch {
          // Ignore cleanup errors
        }
      }
      this.overlayFiles.delete(normalized);
      return;
    }

    // Check if it's in base
    const meta = this.entries.get(normalized);
    if (!meta) {
      throw enoent(normalized);
    }

    if (meta.isDirectory) {
      throw eisdir(normalized);
    }

    this.deleted.add(normalized);
  }

  async commit(): Promise<void> {
    if (this.activeReadStreams > 0) {
      throw new Error(
        `Cannot commit while ${this.activeReadStreams} read streams are active`
      );
    }

    // Create new yazl ZipFile
    const newZipfile = new yazl.ZipFile();
    const tmpPath = this.zipPath + this.tmpSuffix;

    // Add overlay files
    for (const [filePath, entry] of this.overlayFiles.entries()) {
      if (this.deleted.has(filePath)) continue;

      const options: Partial<yazl.Options> = {
        mtime: entry.mtime,
        compress: this.compressOnWrite,
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
    for (const [basePath, meta] of this.entries.entries()) {
      if (this.deleted.has(basePath) || this.overlayFiles.has(basePath))
        continue;

      if (!meta.isDirectory) {
        if (!this.zipfile) continue;

        const options: Partial<yazl.ReadStreamOptions> = {
          mtime: meta.mtime,
          compress: this.compressOnWrite,
        };
        if (meta.mode !== undefined) {
          options.mode = meta.mode & 0xffff;
        }

        newZipfile.addReadStreamLazy(
          basePath,
          options,
          (cb: (err: any, readStream: NodeJS.ReadableStream) => void) => {
            this.zipfile!.openReadStream(meta.entry, cb);
          }
        );
      }
    }

    // Add explicit empty directories
    for (const dirPath of this.overlayDirs.values()) {
      if (!this.deleted.has(dirPath)) {
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
          await fs.promises.rename(tmpPath, this.zipPath);
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
    if (this.zipfile) {
      this.zipfile.close();
    }

    // Reopen and rescan
    await this.buildEntries();

    // Clear overlay
    if (!this.preserveOverlayOnCommit) {
      this.overlayFiles.clear();
      this.overlayDirs.clear();
      this.deleted.clear();

      // Cleanup disk overlay files
      if (this.overlayMode === "disk") {
        // Files are already deleted from overlayFiles, so nothing to clean up
      }
    }
  }

  async open(): Promise<ZipFS> {
    await this.buildEntries();
    return this;
  }

  async close(): Promise<void> {
    if (this.zipfile) {
      this.zipfile.close();
      this.zipfile = null;
    }

    // Clean up disk overlay files if in disk mode
    if (this.overlayMode === "disk") {
      for (const [, entry] of this.overlayFiles.entries()) {
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
}

export async function open(
  zipPath: string,
  options?: {
    compressOnWrite?: boolean;
    tmpSuffix?: string;
    overlayMode?: "memory" | "disk";
    overlayDir?: string;
    preserveOverlayOnCommit?: boolean;
  }
): Promise<ZipFS> {
  const impl = new ZipFS(zipPath, options);

  return impl.open();
}
