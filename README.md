# zipfs

A Node.js-like virtual file system over a single ZIP file with in-memory or disk-based staging, supporting atomic commits back to disk with optional compression.

## Features

- **Merged view**: Read from base ZIP, overlay with staged changes in-memory or on-disk
- **Atomic commits**: Stage multiple changes and commit them atomically with `commit()`
- **Optional compression**: Control whether to compress files on commit (default: no compression)
- **Node-like API**: Familiar `stat`, `readFile`, `readdir`, `createReadStream`, `writeFile`, `mkdir`, `unlink`
- **Overlay modes**: Stage changes either in-memory (fast) or on-disk (memory-efficient)
- **Error handling**: Node-like error codes (`ENOENT`, `EISDIR`, `ENOTDIR`, `EEXIST`)
- **Path validation**: Forward slashes, automatic normalization, traversal prevention

## Installation

```bash
bun install
```

## Quick Start

```typescript
import { open } from "./index";

// Open existing ZIP or create new one
const zip = await open("./archive.zip", { overlayMode: "memory" });

// Read from ZIP
const content = await zip.readFile("file.txt", "utf8");
console.log(content);

// List directory
const files = await zip.readdir("folder");
console.log(files);

// Write changes (staged in overlay)
await zip.writeFile("new-file.txt", "hello world");
await zip.mkdir("new-folder", { recursive: true });
await zip.writeFile("new-folder/file.txt", Buffer.from([1, 2, 3]));

// Delete files
await zip.unlink("old-file.txt");

// Commit all changes to disk
await zip.commit();

// Clean up
await zip.close();
```

## API

### `open(zipPath, options?): Promise<ZipHandle>`

Opens or creates a ZIP file.

**Options:**
- `compressOnWrite` (boolean, default: `false`) - Use compression when committing
- `tmpSuffix` (string, default: `".tmp"`) - Suffix for temp file during atomic write
- `overlayMode` (string, default: `"memory"`) - Where to stage writes: `"memory"` or `"disk"`
- `overlayDir` (string, default: `os.tmpdir()`) - Directory for disk-mode overlay files
- `preserveOverlayOnCommit` (boolean, default: `false`) - Keep overlay after commit

**Returns:** `ZipHandle` interface

### ZipHandle Methods

#### Read Methods

```typescript
// Get file/directory metadata
stat(p: string): Promise<StatsLike>

// Read file content
readFile(p: string, enc?: BufferEncoding): Promise<Buffer | string>

// List directory contents
readdir(p: string): Promise<string[]>

// Create a readable stream for a file
createReadStream(p: string): Readable

// Get FileHandle with createReadStream method
open(p: string): FileHandle
```

**StatsLike interface:**
```typescript
interface StatsLike {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtime: Date;
  mtimeMs: number;
  mode?: number;
}
```

#### Write Methods (Overlay)

```typescript
// Write file (replaces if exists)
writeFile(p: string, data: Buffer | string, opts?: {
  mode?: number;
  mtime?: Date;
  encoding?: BufferEncoding;  // default: "utf8"
}): Promise<void>

// Create directory
mkdir(p: string, opts?: {
  recursive?: boolean;  // create parents if needed
}): Promise<void>

// Delete file (not directories)
unlink(p: string): Promise<void>
```

#### Lifecycle Methods

```typescript
// Commit staged changes atomically to disk
// - Writes new ZIP to temp file
// - Atomically renames temp to actual path
// - Reopens and rescans ZIP
// - Clears overlay (unless preserveOverlayOnCommit)
commit(): Promise<void>

// Close ZIP file and clean up resources
close(): Promise<void>
```

## Design

### Path Normalization

- Forward slashes only (backslashes converted)
- No leading slashes
- Rejects `..` and absolute paths
- Validated via `yauzl.validateFileName`

### Overlay Strategy

**Memory mode (default):**
- Staged files kept in RAM
- Fast for small changes
- Suitable for short-lived operations

**Disk mode:**
- Each file written to temp directory
- Memory-efficient for large changes
- Slower but predictable memory usage

### Commit Process

1. Create new `yazl.ZipFile`
2. Add overlay files (memory via `addBuffer`, disk via `addFile`)
3. Add unchanged base files via `addReadStreamLazy` (skip deleted/overwritten)
4. Add explicit empty directories
5. Write to temp file in same directory as target
6. Atomically rename temp → target
7. Close old yauzl reader
8. Reopen and rebuild index
9. Clear overlay (unless `preserveOverlayOnCommit`)

### Error Handling

- `ENOENT` - File or directory not found
- `EISDIR` - Operation on directory (e.g., `unlink`)
- `ENOTDIR` - Expected directory, found file (e.g., `readdir`)
- `EEXIST` - File/directory already exists

All errors include `code` and `path` properties for Node-like error handling.

## Type Safety

The implementation minimizes type casting (`as any`) and uses proper TypeScript interfaces:
- yauzl types for ZIP entry metadata
- Node.js built-in types for streams and errors
- Custom `StatsLike` for filesystem stats
- Discriminated union for overlay entries (memory vs disk)

## Development

### Type-check
```bash
bun run check
```

### Run example
```bash
bun run index.ts
```

## Notes

- Read streams from base ZIP are not re-opened per read; the zipfile stays open
- Active read streams prevent `commit()` from running (guard added)
- Disk overlay files are cleaned up on `close()`
- Empty directories are only created if explicitly added via `mkdir` or as parents
- Directory entries in base ZIP with trailing `/` are normalized to non-slash format
