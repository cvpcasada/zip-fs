// Export types and interfaces
export type {
  OverlayEntryMemory,
  OverlayEntryDisk,
  OverlayEntry,
  EntryMeta,
  StatsLike,
  FileHandle,
  ZipHandle,
} from "./types";

// Export error class
export { FSError } from "./errors";

// Export main function
export { open } from "./zipHandle";
