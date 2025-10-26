import { open } from "../../index.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Extract Archive Example
 * 
 * Demonstrates:
 * - Reading all files from a ZIP
 * - Streaming files to disk
 * - Creating directory structure on extraction
 * - Progress tracking
 */

async function main() {
  const zipPath = path.join(import.meta.dir, "..", "..", "basic", "example-directories.zip");
  const extractPath = path.join(import.meta.dir, "extracted-archive");

  if (!fs.existsSync(zipPath)) {
    console.log(
      "❌ Please run directory-operations.ts first to create the source archive"
    );
    process.exit(1);
  }

  // Clean up extraction directory if it exists
  if (fs.existsSync(extractPath)) {
    fs.rmSync(extractPath, { recursive: true });
  }
  fs.mkdirSync(extractPath, { recursive: true });

  console.log("📦 Opening ZIP archive for extraction...");
  const zip = await open(zipPath, { overlayMode: "memory" });

  try {
    console.log(`📂 Extracting to: ${extractPath}`);

    // Recursively list all files in ZIP
    const getAllFiles = async (dirPath: string = ""): Promise<string[]> => {
      const entries = await zip.readdir(dirPath);
      const files: string[] = [];

      for (const entry of entries) {
        const fullPath = dirPath ? `${dirPath}/${entry}` : entry;
        const stats = await zip.stat(fullPath);

        if (stats.isFile()) {
          files.push(fullPath);
        } else {
          files.push(...(await getAllFiles(fullPath)));
        }
      }

      return files;
    };

    const allFiles = await getAllFiles();
    console.log(`Found ${allFiles.length} files to extract\n`);

    let extracted = 0;
    let skipped = 0;
    let totalBytes = 0;

    // Extract each file
    for (const filePath of allFiles) {
      const extractFilePath = path.join(extractPath, filePath);
      const dir = path.dirname(extractFilePath);

      // Create parent directories
      fs.mkdirSync(dir, { recursive: true });

      // Read from ZIP and write to disk
      const stream = zip.createReadStream(filePath);
      const writeStream = fs.createWriteStream(extractFilePath);

      await new Promise<void>((resolve, reject) => {
        stream.pipe(writeStream);

        writeStream.on("finish", () => {
          const stats = fs.statSync(extractFilePath);
          totalBytes += stats.size;
          extracted++;
          console.log(`  ✓ ${filePath} (${stats.size} bytes)`);
          resolve();
        });

        writeStream.on("error", reject);
        stream.on("error", reject);
      });
    }

    console.log(`\n📊 Extraction Summary:`);
    console.log(`  Extracted: ${extracted} files`);
    console.log(`  Total size: ${totalBytes} bytes`);
    console.log(`  Extraction path: ${extractPath}`);

    console.log(`\n📂 Extracted directory structure:`);
    const printDir = (dirPath: string, indent: string = "") => {
      const entries = fs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const stat = fs.statSync(fullPath);
        const type = stat.isDirectory() ? "📁" : "📄";
        console.log(`${indent}  ${type} ${entry}`);

        if (stat.isDirectory()) {
          printDir(fullPath, indent + "  ");
        }
      }
    };

    printDir(extractPath);

    console.log("\n✅ Extraction complete!");
    console.log(
      `\n💡 To view extracted files: ls -la ${extractPath}`
    );
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      console.error(`\n❌ Error (${(error as any).code}): ${error.message}`);
    } else {
      console.error("\n❌ Error:", error);
    }
  } finally {
    await zip.close();
  }
}

main().catch(console.error);
