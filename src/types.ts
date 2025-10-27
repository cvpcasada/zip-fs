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
