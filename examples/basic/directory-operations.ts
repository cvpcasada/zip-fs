import { open } from "../../src/index.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Directory Operations Example
 * 
 * Demonstrates:
 * - Creating nested directories
 * - Organizing files in directory structure
 * - Reading nested directories
 * - Recursive directory creation
 * - Error handling (EISDIR, ENOTDIR, etc.)
 */

async function main() {
  const zipPath = path.join(import.meta.dir, "example-directories.zip");

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log("📦 Creating new ZIP with directory structure...");
  const zip = await open(zipPath, { overlayMode: "memory" });

  try {
    console.log("📂 Creating directory structure...");

    // Create directories with recursive flag
    await zip.mkdir("docs", { recursive: true });
    await zip.mkdir("src/components", { recursive: true });
    await zip.mkdir("src/utils", { recursive: true });
    await zip.mkdir("tests/unit", { recursive: true });
    await zip.mkdir("tests/integration", { recursive: true });
    await zip.mkdir("public/assets/images", { recursive: true });

    console.log("✓ Created nested directory structure");

    console.log("\n✍️  Adding files to directories...");

    // Documentation
    await zip.writeFile("docs/README.md", "# Project Documentation");
    await zip.writeFile("docs/CONTRIBUTING.md", "# How to Contribute\n\n1. Fork the repository\n2. Create a branch\n3. Make changes\n4. Submit a PR");
    await zip.writeFile("docs/API.md", "# API Reference\n\n## Installation\n\n```bash\nbun install\n```");

    // Source code
    await zip.writeFile(
      "src/index.ts",
      "export const version = '1.0.0';\nexport * from './components';\nexport * from './utils';"
    );
    await zip.writeFile(
      "src/components/Button.ts",
      "export interface ButtonProps {\n  label: string;\n  onClick: () => void;\n}\n\nexport function Button(props: ButtonProps) { /* ... */ }"
    );
    await zip.writeFile(
      "src/components/Card.ts",
      "export interface CardProps {\n  title: string;\n  content: string;\n}\n\nexport function Card(props: CardProps) { /* ... */ }"
    );
    await zip.writeFile(
      "src/utils/helpers.ts",
      "export function debounce(fn: Function, delay: number) { /* ... */ }\nexport function throttle(fn: Function, delay: number) { /* ... */ }"
    );

    // Tests
    await zip.writeFile("tests/unit/helpers.test.ts", "import { debounce } from '../../src/utils/helpers';\n\ndescribe('debounce', () => {\n  // tests...\n});");
    await zip.writeFile(
      "tests/integration/components.test.ts",
      "import { Button } from '../../src/components/Button';\n\ndescribe('Button Component', () => {\n  // tests...\n});"
    );

    // Public assets
    await zip.writeFile("public/assets/images/logo.svg", "<svg><!-- logo --></svg>");
    await zip.writeFile("public/index.html", "<!DOCTYPE html>\n<html>\n<head><title>My App</title></head>\n<body></body>\n</html>");

    // Root files
    await zip.writeFile("package.json", JSON.stringify({ name: "my-project", version: "1.0.0" }, null, 2));
    await zip.writeFile("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2020", module: "ESNext" } }, null, 2));

    console.log("✓ Added files to directories");

    console.log("\n📊 Directory structure:");
    console.log("  Root files: package.json, tsconfig.json");

    const printDir = async (dirPath: string, indent: string = "") => {
      try {
        const entries = await zip.readdir(dirPath);
        for (const entry of entries) {
          const fullPath = dirPath ? `${dirPath}/${entry}` : entry;
          const stats = await zip.stat(fullPath);
          const type = stats.isDirectory() ? "📁" : "📄";
          console.log(`${indent}  ${type} ${entry}`);

          if (stats.isDirectory()) {
            await printDir(fullPath, indent + "  ");
          }
        }
      } catch (error) {
        // Skip if directory doesn't exist
      }
    };

    await printDir("");

    console.log("\n📈 Statistics:");
    const allFiles = async (dirPath: string = ""): Promise<string[]> => {
      const entries = await zip.readdir(dirPath);
      const files: string[] = [];

      for (const entry of entries) {
        const fullPath = dirPath ? `${dirPath}/${entry}` : entry;
        const stats = await zip.stat(fullPath);

        if (stats.isFile()) {
          files.push(fullPath);
        } else {
          files.push(...(await allFiles(fullPath)));
        }
      }

      return files;
    };

    const allFilesList = await allFiles();
    console.log(`  Total files: ${allFilesList.length}`);
    const totalSize = allFilesList.reduce(async (acc, file) => {
      const stats = await zip.stat(file);
      return (await acc) + stats.size;
    }, Promise.resolve(0));
    console.log(`  Total size: ${await totalSize} bytes`);

    console.log("\n💾 Committing directory structure...");
    await zip.commit();
    console.log(`✓ Archive saved: ${fs.statSync(zipPath).size} bytes`);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      console.error(`\n❌ Error (${(error as any).code}): ${error.message}`);
    } else {
      console.error("\n❌ Error:", error);
    }
  } finally {
    await zip.close();
    console.log("\n✅ Done!");
  }
}

main().catch(console.error);
