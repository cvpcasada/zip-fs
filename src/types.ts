import * as yauzl from "yauzl";
import { Readable } from "stream";

// ============================================================================
// Types
// ============================================================================

export interface OverlayEntryMemory {
  kind: "memory";
  data: Buffer;
  mtime: Date;
  mode?: number;
}

export interface OverlayEntryDisk {
  kind: "disk";
  absPath: string;
  size: number;
  mtime: Date;
  mode?: number;
}

export type OverlayEntry = OverlayEntryMemory | OverlayEntryDisk;

export interface EntryMeta {
  entry: yauzl.Entry;
  isDirectory: boolean;
  size: number;
  mtime: Date;
  mode?: number;
}

export interface StatsLike {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtime: Date;
  mtimeMs: number;
  mode?: number;
}

export interface FileHandle {
  createReadStream(): Readable;
}

export interface ZipHandle {
  stat(p: string): Promise<StatsLike>;
  readFile(p: string, enc?: BufferEncoding): Promise<Buffer | string>;
  readdir(p: string): Promise<string[]>;
  createReadStream(p: string): Readable;
  open(p: string): FileHandle;

  writeFile(
    p: string,
    data: Buffer | string,
    opts?: { mode?: number; mtime?: Date; encoding?: BufferEncoding }
  ): Promise<void>;
  mkdir(p: string, opts?: { recursive?: boolean }): Promise<void>;
  unlink(p: string): Promise<void>;

  commit(): Promise<void>;
  close(): Promise<void>;
}
