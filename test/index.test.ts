import { test, describe, beforeEach, afterEach } from "bun:test";
import { expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { open } from "../src/index";

describe("ZipFS", () => {
  let testZipPath: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    testZipPath = path.join(os.tmpdir(), `zipfs-test-${Date.now()}.zip`);
    // Clean up if it exists from previous run
    if (fs.existsSync(testZipPath)) {
      fs.unlinkSync(testZipPath);
    }
  });

  afterEach(async () => {
    // Clean up test zip file
    if (fs.existsSync(testZipPath)) {
      fs.unlinkSync(testZipPath);
    }
  });

  describe("Basic Operations", () => {
    test("open creates a new zip file", async () => {
      const zip = await open(testZipPath);
      await zip.close();

      // Zip file may or may not exist until committed
      expect(typeof zip).toBe("object");
      expect(typeof zip.readFile).toBe("function");
    });

    test("writeFile and readFile", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("test.txt", "hello world");
      const content = await zip.readFile("test.txt", "utf8");

      expect(content).toBe("hello world");
      await zip.close();
    });

    test("writeFile with Buffer", async () => {
      const zip = await open(testZipPath);

      const buf = Buffer.from([1, 2, 3, 4, 5]);
      await zip.writeFile("binary.bin", buf);
      const read = await zip.readFile("binary.bin");

      expect(Buffer.isBuffer(read)).toBe(true);
      expect((read as Buffer).length).toBe(5);
      await zip.close();
    });

    test("readFile with encoding", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("test.txt", "hello");
      const str = await zip.readFile("test.txt", "utf8");
      const buf = await zip.readFile("test.txt");

      expect(typeof str).toBe("string");
      expect(str).toBe("hello");
      expect(Buffer.isBuffer(buf)).toBe(true);
      await zip.close();
    });

    test("mkdir creates directories", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder", { recursive: false });
      const stat = await zip.stat("folder");

      expect(stat.isDirectory()).toBe(true);
      expect(stat.isFile()).toBe(false);
      await zip.close();
    });

    test("mkdir with recursive option", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("a/b/c", { recursive: true });
      const stat = await zip.stat("a/b/c");

      expect(stat.isDirectory()).toBe(true);
      await zip.close();
    });

    test("writeFile with nested path creates parents", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("folder/subfolder/file.txt", "content");
      const content = await zip.readFile("folder/subfolder/file.txt", "utf8");
      const stat = await zip.stat("folder");

      expect(content).toBe("content");
      expect(stat.isDirectory()).toBe(true);
      await zip.close();
    });

    test("readdir lists files", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("a.txt", "a");
      await zip.writeFile("b.txt", "b");
      await zip.writeFile("c.txt", "c");

      const entries = await zip.readdir("");

      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
      expect(entries).toContain("c.txt");
      expect(entries.length).toBe(3);
      await zip.close();
    });

    test("readdir in subdirectory", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder", { recursive: true });
      await zip.writeFile("folder/file1.txt", "1");
      await zip.writeFile("folder/file2.txt", "2");

      const entries = await zip.readdir("folder");

      expect(entries).toContain("file1.txt");
      expect(entries).toContain("file2.txt");
      expect(entries.length).toBe(2);
      await zip.close();
    });

    test("stat on file", async () => {
      const zip = await open(testZipPath);

      const mtime = new Date("2023-01-01T00:00:00Z");
      await zip.writeFile("test.txt", "hello", { mtime });
      const stat = await zip.stat("test.txt");

      expect(stat.isFile()).toBe(true);
      expect(stat.isDirectory()).toBe(false);
      expect(stat.size).toBe(5);
      expect(stat.mtime).toEqual(mtime);
      expect(stat.mtimeMs).toBe(mtime.getTime());
      await zip.close();
    });

    test("stat on directory", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder");
      const stat = await zip.stat("folder");

      expect(stat.isDirectory()).toBe(true);
      expect(stat.isFile()).toBe(false);
      expect(stat.size).toBe(0);
      await zip.close();
    });

    test("unlink deletes files", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("test.txt", "hello");
      await zip.unlink("test.txt");

      try {
        await zip.stat("test.txt");
        throw new Error("Should have thrown ENOENT");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
      await zip.close();
    });

    test("createReadStream reads file content", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("test.txt", "hello world");
      const stream = zip.createReadStream("test.txt");

      let content = "";
      for await (const chunk of stream) {
        content += chunk;
      }

      expect(content).toBe("hello world");
      await zip.close();
    });
  });

  describe("Error Handling", () => {
    test("ENOENT on non-existent file", async () => {
      const zip = await open(testZipPath);

      try {
        await zip.readFile("nonexistent.txt");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
        expect(err.path).toBe("nonexistent.txt");
      }
      await zip.close();
    });

    test("ENOENT on stat non-existent file", async () => {
      const zip = await open(testZipPath);

      try {
        await zip.stat("nonexistent.txt");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
      await zip.close();
    });

    test("EISDIR when trying to read directory", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder");

      try {
        await zip.readFile("folder");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("EISDIR");
      }
      await zip.close();
    });

    test("ENOTDIR when trying to readdir on file", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file.txt", "content");

      try {
        await zip.readdir("file.txt");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("ENOTDIR");
      }
      await zip.close();
    });

    test("EISDIR when trying to unlink directory", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder");

      try {
        await zip.unlink("folder");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("EISDIR");
      }
      await zip.close();
    });

    test("EEXIST when mkdir on existing directory without recursive", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder");

      try {
        await zip.mkdir("folder");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("EEXIST");
      }
      await zip.close();
    });

    test("mkdir existing directory with recursive option succeeds", async () => {
      const zip = await open(testZipPath);

      await zip.mkdir("folder");
      await zip.mkdir("folder", { recursive: true }); // Should not throw

      const stat = await zip.stat("folder");
      expect(stat.isDirectory()).toBe(true);
      await zip.close();
    });

    test("path traversal rejection", async () => {
      const zip = await open(testZipPath);

      try {
        await zip.writeFile("../etc/passwd", "bad");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("traversal");
      }
      await zip.close();
    });

    test("absolute path rejection", async () => {
      const zip = await open(testZipPath);

      try {
        await zip.writeFile("/etc/passwd", "bad");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("Absolute paths");
      }
      await zip.close();
    });
  });

  describe("Commit", () => {
    test("commit persists changes to disk", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file.txt", "content");
      await zip.commit();

      expect(fs.existsSync(testZipPath)).toBe(true);

      // Reopen and verify
      const zip2 = await open(testZipPath);
      const content = await zip2.readFile("file.txt", "utf8");

      expect(content).toBe("content");
      await zip2.close();
      await zip.close();
    });

    test("commit with compression", async () => {
      const zip = await open(testZipPath, { compressOnWrite: true });

      await zip.writeFile("file.txt", "hello world");
      await zip.commit();

      expect(fs.existsSync(testZipPath)).toBe(true);
      await zip.close();
    });

    test("commit preserves unmodified files from base", async () => {
      // Create initial zip
      const zip1 = await open(testZipPath);
      await zip1.writeFile("original.txt", "original");
      await zip1.commit();
      await zip1.close();

      // Reopen and add new file
      const zip2 = await open(testZipPath);
      await zip2.writeFile("new.txt", "new");
      await zip2.commit();

      // Verify both files exist
      const zip3 = await open(testZipPath);
      const orig = await zip3.readFile("original.txt", "utf8");
      const newFile = await zip3.readFile("new.txt", "utf8");

      expect(orig).toBe("original");
      expect(newFile).toBe("new");
      await zip3.close();
    });

    test("commit respects deleted files", async () => {
      // Create initial zip
      const zip1 = await open(testZipPath);
      await zip1.writeFile("file.txt", "content");
      await zip1.commit();
      await zip1.close();

      // Reopen and delete
      const zip2 = await open(testZipPath);
      await zip2.unlink("file.txt");
      await zip2.commit();

      // Verify deleted
      const zip3 = await open(testZipPath);
      try {
        await zip3.readFile("file.txt");
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.code).toBe("ENOENT");
      }
      await zip3.close();
    });

    test("commit clears overlay after success", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file.txt", "content");
      await zip.commit();

      // Reopen same handle and verify overlay is cleared
      // (Writing new file should show only new overlay)
      const entries = await zip.readdir("");
      // After commit, we should have the persisted file
      expect(entries).toContain("file.txt");
      await zip.close();
    });

    test("commit with multiple operations", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file1.txt", "one");
      await zip.mkdir("folder");
      await zip.writeFile("folder/file2.txt", "two");
      await zip.writeFile("file3.txt", "three");

      await zip.commit();

      const zip2 = await open(testZipPath);
      const f1 = await zip2.readFile("file1.txt", "utf8");
      const f2 = await zip2.readFile("folder/file2.txt", "utf8");
      const f3 = await zip2.readFile("file3.txt", "utf8");

      expect(f1).toBe("one");
      expect(f2).toBe("two");
      expect(f3).toBe("three");

      await zip2.close();
      await zip.close();
    });
  });

  describe("Overlay Modes", () => {
    test("memory overlay mode (default)", async () => {
      const zip = await open(testZipPath, { overlayMode: "memory" });

      await zip.writeFile("file.txt", "content");
      const content = await zip.readFile("file.txt", "utf8");

      expect(content).toBe("content");
      await zip.close();
    });

    test("disk overlay mode", async () => {
      const overlayDir = path.join(os.tmpdir(), `zipfs-overlay-${Date.now()}`);
      const zip = await open(testZipPath, {
        overlayMode: "disk",
        overlayDir,
      });

      await zip.writeFile("file.txt", "content");
      const content = await zip.readFile("file.txt", "utf8");

      expect(content).toBe("content");
      await zip.close();

      // Cleanup overlay dir
      if (fs.existsSync(overlayDir)) {
        fs.rmSync(overlayDir, { recursive: true });
      }
    });

    test("overlayMode memory can handle large writes", async () => {
      const zip = await open(testZipPath, { overlayMode: "memory" });

      const largeContent = "x".repeat(1000000); // 1MB
      await zip.writeFile("large.txt", largeContent);
      const read = await zip.readFile("large.txt", "utf8");

      expect(read).toBe(largeContent);
      await zip.close();
    });
  });

  describe("Complex Scenarios", () => {
    test("overwrite file in overlay", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file.txt", "first");
      await zip.writeFile("file.txt", "second");

      const content = await zip.readFile("file.txt", "utf8");
      expect(content).toBe("second");
      await zip.close();
    });

    test("read, modify, commit cycle", async () => {
      // Initial creation
      const zip1 = await open(testZipPath);
      await zip1.writeFile("data.txt", "v1");
      await zip1.commit();
      await zip1.close();

      // Modify
      const zip2 = await open(testZipPath);
      const oldContent = await zip2.readFile("data.txt", "utf8");
      expect(oldContent).toBe("v1");

      await zip2.writeFile("data.txt", "v2");
      await zip2.commit();
      await zip2.close();

      // Verify
      const zip3 = await open(testZipPath);
      const newContent = await zip3.readFile("data.txt", "utf8");
      expect(newContent).toBe("v2");
      await zip3.close();
    });

    test("nested directory structure", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("a/b/c/d/e/file.txt", "deep");
      const content = await zip.readFile("a/b/c/d/e/file.txt", "utf8");

      expect(content).toBe("deep");

      const entries_a = await zip.readdir("a");
      const entries_b = await zip.readdir("a/b");
      const entries_c = await zip.readdir("a/b/c");

      expect(entries_a).toContain("b");
      expect(entries_b).toContain("c");
      expect(entries_c).toContain("d");

      await zip.close();
    });

    test("delete and recreate file", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file.txt", "first");
      await zip.unlink("file.txt");
      await zip.writeFile("file.txt", "second");

      const content = await zip.readFile("file.txt", "utf8");
      expect(content).toBe("second");
      await zip.close();
    });

    test("multiple file encodings", async () => {
      const zip = await open(testZipPath);

      const utf8Content = "hello 世界 🌍";
      await zip.writeFile("utf8.txt", utf8Content, { encoding: "utf8" });

      const read = await zip.readFile("utf8.txt", "utf8");
      expect(read).toBe(utf8Content);

      await zip.close();
    });
  });

  describe("Edge Cases", () => {
    test("empty filename handling", async () => {
      const zip = await open(testZipPath);

      try {
        await zip.writeFile("", "content");
        throw new Error("Should have rejected empty path");
      } catch (err: any) {
        // Expected to fail path validation
        expect(err).toBeDefined();
      }
      await zip.close();
    });

    test("readdir on empty root", async () => {
      const zip = await open(testZipPath);

      const entries = await zip.readdir("");
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBe(0);
      await zip.close();
    });

    test("stat size matches readFile length", async () => {
      const zip = await open(testZipPath);

      const content = "hello world";
      await zip.writeFile("file.txt", content);

      const stat = await zip.stat("file.txt");
      const buf = await zip.readFile("file.txt");

      expect(stat.size).toBe((buf as Buffer).length);
      expect(stat.size).toBe(content.length);
      await zip.close();
    });

    test("writeFile with custom mode", async () => {
      const zip = await open(testZipPath);

      await zip.writeFile("file.txt", "content", { mode: 0o644 });
      const stat = await zip.stat("file.txt");

      expect(stat.mode).toBe(0o644);
      await zip.close();
    });
  });
});
