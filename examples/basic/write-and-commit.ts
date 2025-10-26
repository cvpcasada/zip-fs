import { open } from "../../index.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Write and Commit Example
 * 
 * Demonstrates:
 * - Opening an existing ZIP file
 * - Staging multiple changes
 * - Atomic commits
 * - Error handling
 */

async function main() {
  const zipPath = path.join(import.meta.dir, "example-write-commit.zip");

  // Start with a base ZIP created by the previous example
  const baseZip = path.join(import.meta.dir, "example-basic.zip");
  if (!fs.existsSync(baseZip)) {
    console.log(
      "❌ Please run create-and-read.ts first to create the base archive"
    );
    process.exit(1);
  }

  // Copy base ZIP to work with
  fs.copyFileSync(baseZip, zipPath);

  console.log("📦 Opening existing ZIP archive...");
  const zip = await open(zipPath, { overlayMode: "memory" });

  try {
    console.log("📖 Original content:");
    const originalFiles = await zip.readdir("");
    console.log(`  Files: ${originalFiles.join(", ")}`);

    console.log("\n✍️  Staging changes (in-memory overlay)...");

    // Modify existing file
    await zip.writeFile("hello.txt", "Hello, Updated World! 🚀");

    // Add new files
    await zip.writeFile("new-file.txt", "This is a new file added to the archive");

    // Create a configuration file
    await zip.writeFile(
      "config.yml",
      `
app:
  name: My Application
  version: 2.0.0
  timestamp: ${new Date().toISOString()}
features:
  - streaming
  - compression
  - atomic-commits
`.trim()
    );

    console.log(
      "✓ Staged: modified hello.txt, added new-file.txt, added config.yml"
    );

    console.log("\n📂 Current directory listing (with staged changes)...");
    const stagedFiles = await zip.readdir("");
    console.log(`  Files: ${stagedFiles.join(", ")}`);

    console.log("\n📖 Reading modified content (before commit)...");
    const updated = await zip.readFile("hello.txt", "utf8");
    console.log(`  hello.txt: "${updated}"`);

    console.log("\n💾 Committing all changes atomically...");
    console.log("  → Writing changes to temporary file");
    console.log("  → Atomically renaming to final path");
    console.log("  → Rescanning ZIP index");

    await zip.commit();

    console.log("✓ Commit successful!");

    console.log("\n📊 Post-commit verification...");
    const finalFiles = await zip.readdir("");
    console.log(`  Files after commit: ${finalFiles.join(", ")}`);

    // Verify the committed file was written correctly
    const committed = await zip.readFile("hello.txt", "utf8");
    console.log(`  Verification: hello.txt = "${committed}"`);

    console.log(
      `\n✅ Archive saved with atomic commit: ${fs.statSync(zipPath).size} bytes`
    );
  } catch (error) {
    // Handle potential errors
    if (error instanceof Error && "code" in error) {
      console.error(
        `\n❌ Error (${(error as any).code}): ${error.message}`
      );
    } else {
      console.error("\n❌ Error:", error);
    }
  } finally {
    await zip.close();
    console.log("✅ Done!");
  }
}

main().catch(console.error);
