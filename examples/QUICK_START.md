# ZipFS Quick Start Guide

## Running Examples

All examples are runnable TypeScript files. Use Bun to execute them:

```bash
# Basic examples
bun examples/basic/create-and-read.ts
bun examples/basic/write-and-commit.ts
bun examples/basic/directory-operations.ts

# Streaming examples
bun examples/streaming/stream-processing.ts
bun examples/streaming/extract-archive.ts

# Real-world use cases
bun examples/batch-operations/database-backup.ts
bun examples/batch-operations/content-version-control.ts
```

## Common Patterns

### Creating a New ZIP Archive

```typescript
import { open } from "../index.ts";
import * as path from "path";

const zip = await open(path.join(import.meta.dir, "my-archive.zip"), { overlayMode: "memory" });

// Make changes
await zip.writeFile("file.txt", "Hello, World!");

// Commit atomically
await zip.commit();

// Clean up
await zip.close();
```

### Reading Files

```typescript
// Read as string
const content = await zip.readFile("file.txt", "utf8");

// Read as Buffer
const binary = await zip.readFile("image.png");

// List directory
const files = await zip.readdir("folder");

// Check if file exists
try {
  const stats = await zip.stat("file.txt");
  console.log("File size:", stats.size);
  console.log("Is file:", stats.isFile());
} catch (error) {
  console.log("File not found");
}
```

### Writing Files

```typescript
// Text file
await zip.writeFile("readme.md", "# Documentation");

// Binary data
await zip.writeFile("data.bin", Buffer.from([1, 2, 3]));

// With metadata
await zip.writeFile("file.txt", "content", {
  mode: 0o644,
  mtime: new Date(),
  encoding: "utf8",
});
```

### Creating Directories

```typescript
// Create with parents (recursive)
await zip.mkdir("path/to/nested/folder", { recursive: true });

// Create single directory
await zip.mkdir("folder");
```

### Streaming Large Files

```typescript
// Memory-efficient reading
const stream = zip.createReadStream("large-file.bin");

stream.on("data", (chunk: Buffer) => {
  console.log("Processing chunk of size:", chunk.length);
});

stream.on("end", () => {
  console.log("Stream finished");
});

// Or pipe to another stream
stream.pipe(fs.createWriteStream("output.bin"));
```

### Error Handling

```typescript
try {
  await zip.readFile("nonexistent.txt");
} catch (error) {
  if ((error as any).code === "ENOENT") {
    console.log("File not found");
  } else if ((error as any).code === "EISDIR") {
    console.log("Path is a directory, not a file");
  } else if ((error as any).code === "ENOTDIR") {
    console.log("Path is a file, not a directory");
  }
}
```

## Key Concepts

### Overlay Modes

**Memory Mode** (default - fastest for small changes):
```typescript
const zip = await open("archive.zip", { overlayMode: "memory" });
```

**Disk Mode** (better for large changes):
```typescript
const zip = await open(path.join(import.meta.dir, "archive.zip"), {
  overlayMode: "disk",
  overlayDir: path.join(import.meta.dir, "overlay"), // where temp files are stored
});
```

### Atomic Commits

All changes are staged in an overlay and committed atomically:

```typescript
// Stage multiple changes
await zip.writeFile("file1.txt", "data1");
await zip.writeFile("file2.txt", "data2");
await zip.mkdir("new-folder");

// All committed atomically (all succeed or all fail)
await zip.commit();
```

### Options

```typescript
const zip = await open(path.join(import.meta.dir, "archive.zip"), {
  // Where to stage changes: "memory" or "disk"
  overlayMode: "memory",

  // Directory for disk overlay files
  overlayDir: path.join(import.meta.dir, "my-overlay"),

  // Enable compression when committing
  compressOnWrite: false,

  // Temporary file suffix during atomic write
  tmpSuffix: ".tmp",

  // Keep overlay after commit (default: false)
  preserveOverlayOnCommit: false,
});
```

## Performance Tips

1. **Use memory mode for rapid changes** - Good for < 100MB total changes
2. **Use disk mode for large files** - More memory-efficient, slightly slower
3. **Batch operations** - Make multiple changes before calling `commit()`
4. **Use streams** - Process large files incrementally with `createReadStream()`
5. **Close properly** - Always call `close()` to cleanup resources
6. **Handle errors** - Use try/finally to ensure cleanup happens

## Use Cases

### Configuration Management
Store versioned configuration in ZIP with metadata about each version.

### Database Backups
Create multiple versioned backups in a single atomic operation with manifests.

### Document Versioning
Version control system for document collections with commit history.

### Content Distribution
Package and distribute content as a single ZIP with file listings.

### Data Archival
Store historical data efficiently with atomic multi-version commits.

### Stream Processing
Process large files using streams to minimize memory usage.

## Troubleshooting

### "ENOENT: no such file or directory"
The file or directory doesn't exist. Use `readdir()` to check what exists, or use `stat()` to verify.

### "EISDIR: illegal operation on a directory"
You're trying to use a file operation on a directory (e.g., `unlink()` on a directory).

### "ENOTDIR: not a directory"
You're trying to read a directory as if it's a file (e.g., `readdir()` on a file).

### Memory Usage Growing
You might be using memory mode with very large files. Consider switching to disk mode:
```typescript
const zip = await open("archive.zip", { overlayMode: "disk" });
```

### Streams Not Closing
Always properly close streams and the ZIP handle:
```typescript
try {
  // operations
} finally {
  await zip.close(); // Closes all resources
}
```

## See Examples

Each example in this folder demonstrates different features:

- **create-and-read.ts** - Basic file I/O operations
- **write-and-commit.ts** - Staging and atomic commits
- **directory-operations.ts** - Working with nested directories
- **stream-processing.ts** - Memory-efficient file processing
- **extract-archive.ts** - Extracting entire archives
- **database-backup.ts** - Versioned backup system
- **content-version-control.ts** - Document version control

Run any example to see it in action!
