# ZipFS Examples

This folder contains practical examples demonstrating how to use the zipfs library for common use cases.

## Quick Start

All examples use Bun, so you can run them directly:

```bash
bun examples/basic/create-and-read.ts
bun examples/basic/write-and-commit.ts
bun examples/basic/directory-operations.ts
bun examples/streaming/stream-processing.ts
bun examples/streaming/extract-archive.ts
bun examples/batch-operations/database-backup.ts
bun examples/batch-operations/content-version-control.ts
```

## Examples Overview

### Basic Operations
- **create-and-read.ts** - Create a new ZIP, read files and directories
- **write-and-commit.ts** - Write files, make staged changes, and commit atomically
- **directory-operations.ts** - Create directories, list contents, and handle nested structures

### Streaming & Performance
- **stream-processing.ts** - Process large files using streams for memory efficiency
- **extract-archive.ts** - Extract all files from a ZIP archive

### Batch Operations & Real-World Use Cases
- **database-backup.ts** - Create versioned database backups with atomic commits
- **content-version-control.ts** - Version control system for document collections

## Key Concepts

### Overlay Modes
- **Memory Mode** (default): Fast for small changes, keeps changes in RAM
- **Disk Mode**: Memory-efficient for large changes, stores changes on disk

### Atomic Commits
Changes are staged in an overlay and committed atomically to disk - either all changes succeed or none do.

### Error Handling
All examples include error handling with Node-like error codes (`ENOENT`, `EISDIR`, `ENOTDIR`, `EEXIST`).

## Running Tests

To verify the examples work correctly:

```bash
bun test examples/
```

## Tips

- Use memory mode for rapid prototyping and small changes
- Use disk mode when processing large files to avoid memory issues
- Always call `close()` to clean up resources
- Use streams for processing large files to minimize memory usage
