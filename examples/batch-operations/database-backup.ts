import { open } from "../../index.ts";
import * as fs from "fs";
import * as path from "path";

/**
 * Database Backup Example
 * 
 * A realistic scenario demonstrating:
 * - Creating versioned database backups
 * - Atomic commits (all-or-nothing)
 * - Metadata and manifests
 * - Cleanup of old versions
 */

interface BackupManifest {
  version: string;
  timestamp: string;
  tables: string[];
  totalSize: number;
  checksum?: string;
}

async function main() {
  const backupZip = path.join(import.meta.dir, "database-backups.zip");

  // Clean up if exists
  if (fs.existsSync(backupZip)) {
    fs.unlinkSync(backupZip);
  }

  console.log("📦 Database Backup System with ZIP Archive");
  console.log("==========================================\n");

  const zip = await open(backupZip, { overlayMode: "memory" });

  try {
    // Simulate database tables
    const mockDatabaseTables: Record<string, any[]> = {
      users: [
        { id: 1, name: "Alice Johnson", email: "alice@company.com", created: "2024-01-15" },
        { id: 2, name: "Bob Smith", email: "bob@company.com", created: "2024-01-20" },
        { id: 3, name: "Carol White", email: "carol@company.com", created: "2024-02-01" },
      ],
      products: [
        { id: 101, name: "Widget A", price: 29.99, stock: 100 },
        { id: 102, name: "Widget B", price: 49.99, stock: 50 },
        { id: 103, name: "Gadget X", price: 199.99, stock: 10 },
      ],
      orders: [
        { id: 1001, userId: 1, productId: 101, quantity: 2, total: 59.98 },
        { id: 1002, userId: 2, productId: 102, quantity: 1, total: 49.99 },
      ],
    };

    // Create multiple backup versions
    for (let version = 1; version <= 3; version++) {
      console.log(`\n🔄 Creating backup version ${version}...`);

      // Create backup directory structure
      const backupDir = `backups/v${version}`;
      await zip.mkdir(backupDir, { recursive: true });

      // Export each table as JSON
      const tables: string[] = [];
      for (const [tableName, tableData] of Object.entries(mockDatabaseTables)) {
        // Simulate data changes across versions
        let data: any[] = tableData;
        if (version === 2 && tableName === "users") {
          // Version 2: Add a new user
          data = [
            ...tableData,
            { id: 4, name: "Diana Prince", email: "diana@company.com", created: "2024-02-10" },
          ];
        } else if (version === 3 && tableName === "products") {
          // Version 3: Update pricing
          data = tableData.map((item: any) => ({
            ...item,
            price: item.price * 1.1, // 10% increase
          }));
        }

        const filePath = `${backupDir}/${tableName}.json`;
        await zip.writeFile(filePath, JSON.stringify(data, null, 2));
        tables.push(tableName);
        console.log(`  ✓ Exported table: ${tableName} (${data.length} records)`);
      }

      // Create backup manifest
      const manifest: BackupManifest = {
        version: `v${version}`,
        timestamp: new Date().toISOString(),
        tables: tables,
        totalSize: tables.reduce((sum) => sum + 1000, 0), // Simplified size calculation
      };

      const manifestPath = `${backupDir}/manifest.json`;
      await zip.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`  ✓ Created manifest: ${manifestPath}`);
    }

    console.log("\n💾 All changes staged in memory overlay. Committing atomically...");
    await zip.commit();
    console.log("✓ All backups committed atomically to disk!");

    console.log("\n📖 Reading backup inventory...");
    const backupDirs = await zip.readdir("backups");
    console.log(`\nAvailable backups: ${backupDirs.join(", ")}`);

    // Read manifests from each backup
    for (const backupName of backupDirs) {
      const manifestPath = `backups/${backupName}/manifest.json`;
      const manifestData = await zip.readFile(manifestPath, "utf8");
      const manifest = JSON.parse(manifestData as string) as BackupManifest;

      console.log(`\n📋 Backup: ${manifest.version}`);
      console.log(`   Created: ${manifest.timestamp}`);
      console.log(`   Tables: ${manifest.tables.join(", ")}`);

      // Show sample data from first backup
      if (backupName === "v1") {
        const usersPath = `backups/${backupName}/users.json`;
        const usersData = await zip.readFile(usersPath, "utf8");
        const users = JSON.parse(usersData as string);
        console.log(`   Users: ${users.length} records`);
        console.log(`     - ${users[0].name}`);
        console.log(`     - ${users[1].name}`);
      }
    }

    // Demonstrate recovery from a specific version
    console.log("\n🔄 Demonstrating Recovery from v2...");
    const v2UsersPath = "backups/v2/users.json";
    const recoveryData = await zip.readFile(v2UsersPath, "utf8");
    const recoveredUsers = JSON.parse(recoveryData as string);
    console.log(`✓ Recovered ${recoveredUsers.length} user records from v2:`);
    recoveredUsers.forEach((user: any) => {
      console.log(`  - ${user.name} (${user.email})`);
    });

    // Show the atomic nature of commits
    console.log("\n💡 Key Benefits Demonstrated:");
    console.log("  ✓ Atomic commits: All 3 versions written in one atomic operation");
    console.log("  ✓ Versioning: Multiple snapshots preserved");
    console.log("  ✓ Metadata: Manifests track structure and timestamps");
    console.log("  ✓ Easy recovery: Simply read from the desired backup version");
    console.log("  ✓ Compression: Save space by storing multiple versions together");

    console.log(`\n📊 Final archive size: ${fs.statSync(backupZip).size} bytes`);
    console.log(`📦 Archive location: ${backupZip}`);
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      console.error(`\n❌ Error (${(error as any).code}): ${error.message}`);
    } else {
      console.error("\n❌ Error:", error);
    }
  } finally {
    await zip.close();
    console.log("\n✅ Backup operation complete!");
  }
}

main().catch(console.error);
