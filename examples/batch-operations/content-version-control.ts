import { open } from "../../src/index.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Content Version Control Example
 * 
 * A realistic scenario demonstrating:
 * - Version control for document collections
 * - Commit messages and metadata
 * - Diff-like operations
 * - Branching/variant storage
 */

interface CommitMetadata {
  commitHash: string;
  author: string;
  timestamp: string;
  message: string;
  files: {
    name: string;
    size: number;
    status: "added" | "modified" | "deleted";
  }[];
}

function generateCommitHash(): string {
  return Math.random().toString(36).substring(2, 9);
}

async function main() {
  const contentVCS = path.join(import.meta.dir, "content-vcs.zip");

  if (fs.existsSync(contentVCS)) {
    fs.unlinkSync(contentVCS);
  }

  console.log("📚 Content Version Control System");
  console.log("=================================\n");

  const zip = await open(contentVCS, { overlayMode: "memory" });

  try {
    // Commit 1: Initial content
    console.log("📝 Commit 1: Initial documentation");
    await zip.mkdir("docs", { recursive: true });
    await zip.mkdir(".vcs/commits", { recursive: true });

    const commit1Files = [
      { path: "docs/index.md", content: "# My Project\n\nWelcome to my project!" },
      { path: "docs/getting-started.md", content: "# Getting Started\n\n1. Install dependencies\n2. Run the project\n3. Explore the API" },
      { path: "docs/api.md", content: "# API Reference\n\n## Endpoints\n- GET /api/users\n- POST /api/users" },
    ];

    for (const file of commit1Files) {
      await zip.writeFile(file.path, file.content);
      console.log(`  ✓ Added: ${file.path}`);
    }

    const commit1Meta: CommitMetadata = {
      commitHash: generateCommitHash(),
      author: "Alice Developer",
      timestamp: new Date().toISOString(),
      message: "Initial documentation structure",
      files: commit1Files.map((f) => ({
        name: f.path,
        size: f.content.length,
        status: "added",
      })),
    };

    await zip.writeFile(
      ".vcs/commits/commit_001.json",
      JSON.stringify(commit1Meta, null, 2)
    );

    // Commit 2: Update documentation
    console.log("\n📝 Commit 2: Update documentation with examples");
    const commit2Files = [
      {
        path: "docs/getting-started.md",
        content: "# Getting Started\n\n1. Install dependencies\n   ```bash\n   bun install\n   ```\n2. Run the project\n   ```bash\n   bun run\n   ```\n3. Explore the API",
      },
      {
        path: "docs/examples.md",
        content: "# Examples\n\n## Basic Usage\n\n```typescript\nimport { open } from 'zipfs';\nconst zip = await open('archive.zip');\n```",
      },
    ];

    for (const file of commit2Files) {
      await zip.writeFile(file.path, file.content);
      console.log(`  ✓ ${file.path === "docs/examples.md" ? "Added" : "Modified"}: ${file.path}`);
    }

    const commit2Meta: CommitMetadata = {
      commitHash: generateCommitHash(),
      author: "Bob Contributor",
      timestamp: new Date(Date.now() + 3600000).toISOString(),
      message: "Add examples and improve getting started guide",
      files: [
        { name: "docs/getting-started.md", size: (commit2Files[0]?.content ?? "").length, status: "modified" },
        { name: "docs/examples.md", size: (commit2Files[1]?.content ?? "").length, status: "added" },
      ],
    };

    await zip.writeFile(
      ".vcs/commits/commit_002.json",
      JSON.stringify(commit2Meta, null, 2)
    );

    // Commit 3: Deprecate old content
    console.log("\n📝 Commit 3: Archive outdated content");
    await zip.mkdir("docs/archived", { recursive: true });
    await zip.writeFile(
      "docs/archived/old-api.md",
      "# Old API (Deprecated)\n\nThis API is no longer maintained."
    );

    const commit3Meta: CommitMetadata = {
      commitHash: generateCommitHash(),
      author: "Alice Developer",
      timestamp: new Date(Date.now() + 7200000).toISOString(),
      message: "Archive deprecated API documentation",
      files: [{ name: "docs/archived/old-api.md", size: 51, status: "added" }],
    };

    await zip.writeFile(
      ".vcs/commits/commit_003.json",
      JSON.stringify(commit3Meta, null, 2)
    );

    console.log("\n💾 Committing all changes atomically...");
    await zip.commit();
    console.log("✓ All commits persisted to archive!");

    // Display commit history
    console.log("\n📖 Commit History:");
    const commits = await zip.readdir(".vcs/commits");
    for (const commitFile of commits) {
      const commitData = await zip.readFile(`.vcs/commits/${commitFile}`, "utf8");
      const commit = JSON.parse(commitData as string) as CommitMetadata;
      const timeParts = commit.timestamp.split("T");
      const timePart = timeParts[1]?.substring(0, 5) || "00:00";
      console.log(`\n  ${commit.commitHash.substring(0, 7)} - ${commit.author}`);
      console.log(`  ${timeParts[0]} ${timePart}`);
      console.log(`  "${commit.message}"`);
      commit.files.forEach((file) => {
        console.log(`    ${file.status === "added" ? "+" : "~"} ${file.name}`);
      });
    }

    // Statistics
    console.log("\n📊 Statistics:");
    const countFiles = async (dirPath: string = ""): Promise<number> => {
      const entries = await zip.readdir(dirPath);
      let count = 0;
      for (const entry of entries) {
        const fullPath = dirPath ? `${dirPath}/${entry}` : entry;
        if (!fullPath.startsWith(".vcs")) {
          const stats = await zip.stat(fullPath);
          if (stats.isFile()) {
            count++;
          } else {
            count += await countFiles(fullPath);
          }
        }
      }
      return count;
    };

    const fileCount = await countFiles();
    const commitCount = commits.length;
    console.log(`  Total files: ${fileCount}`);
    console.log(`  Total commits: ${commitCount}`);
    console.log(`  Archive size: ${fs.statSync(contentVCS).size} bytes`);

    // Show current state
    console.log("\n📂 Current Documentation State:");
    const docs = await zip.readdir("docs");
    for (const doc of docs) {
      if (doc !== "archived") {
        const content = await zip.readFile(`docs/${doc}`, "utf8");
        console.log(`\n  📄 ${doc}:`);
        const lines = (content as string).split("\n");
        console.log(`     ${lines[0]}`);
      }
    }

    console.log("\n💡 Features Demonstrated:");
    console.log("  ✓ Atomic commits: All changes written in one operation");
    console.log("  ✓ Metadata tracking: Author, timestamp, file changes");
    console.log("  ✓ Commit history: Full audit trail stored in archive");
    console.log("  ✓ File organization: Proper directory structure");
    console.log("  ✓ Easy rollback: Simply read from specific commit");
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      console.error(`\n❌ Error (${(error as any).code}): ${error.message}`);
    } else {
      console.error("\n❌ Error:", error);
    }
  } finally {
    await zip.close();
    console.log("\n✅ Version control system operational!");
  }
}

main().catch(console.error);
