import { open } from "../../index.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Basic Example: Create and Read a ZIP Archive
 * 
 * Demonstrates:
 * - Creating a new ZIP file
 * - Writing files to the archive
 * - Reading files from the archive
 * - Listing directory contents
 * - Committing changes to disk
 */

async function main() {
  const zipPath = path.join(import.meta.dir, "example-basic.zip");

  // Clean up any existing ZIP from previous runs
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log("📦 Creating new ZIP archive...");

  // Open or create a new ZIP file
  const zip = await open(zipPath, { overlayMode: "disk" });

  try {
    // Write some text files
    console.log("✍️  Writing files to archive...");
    await zip.writeFile("hello.txt", "Hello, World!");
    await zip.writeFile("readme.md", "# My Archive\n\nThis is a test archive.");

    // Write a JSON file
    await zip.writeFile(
      "data.json",
      JSON.stringify(
        {
          name: "zipfs-example",
          version: "1.0.0",
          created: new Date().toISOString(),
        },
        null,
        2
      )
    );

    // Write binary data
    await zip.writeFile("binary.dat", Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG header

    console.log("📖 Reading files from archive...");

    // Read text file as string
    const hello = await zip.readFile("hello.txt", "utf8");
    console.log(`✓ hello.txt: "${hello}"`);

    // Read JSON file
    const dataStr = await zip.readFile("data.json", "utf8");
    const data = JSON.parse(dataStr as string);
    console.log(`✓ data.json: ${JSON.stringify(data)}`);

    // Read binary file as Buffer
    const binary = await zip.readFile("binary.dat");
    console.log(
      `✓ binary.dat: ${(binary as Buffer).toString("hex")} (PNG header)`
    );

    console.log("\n📂 Listing root directory...");
    const files = await zip.readdir("");
    console.log(`Found ${files.length} files:`, files);

    console.log("\n📊 File metadata...");
    for (const file of files) {
      const stats = await zip.stat(file);
      console.log(
        `  ${file}: ${stats.size} bytes, ${stats.isFile() ? "file" : "dir"}`
      );
    }

    console.log("\n💾 Committing changes to disk...");
    await zip.commit();
    console.log(`✓ Archive saved to: ${zipPath}`);
    console.log(`✓ File size: ${fs.statSync(zipPath).size} bytes`);
  } finally {
    // Clean up resources
    await zip.close();
    console.log("\n✅ Done!");
  }
}

main().catch(console.error);
