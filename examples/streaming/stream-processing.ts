import { open } from "../../src/index.ts";
import * as fs from "fs";
import { Transform } from "stream";
import * as path from "path";

/**
 * Stream Processing Example
 * 
 * Demonstrates:
 * - Using createReadStream for memory-efficient file reading
 * - Processing large files with streams
 * - Transforming streams (word counting example)
 * - Piping streams together
 */

async function main() {
  const zipPath = path.join(import.meta.dir, "example-streaming.zip");

  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }

  console.log("📦 Creating ZIP with sample files for streaming...");
  const zip = await open(zipPath, { overlayMode: "memory" });

  try {
    // Create sample text files with realistic content
    console.log("✍️  Creating sample text files...");

    const loremIpsum =
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(100);
    const shakespeareSample = `To be, or not to be, that is the question:
Whether 'tis nobler in the mind to suffer
The slings and arrows of outrageous fortune,
Or to take arms against a sea of troubles
And by opposing end them. `.repeat(50);

    await zip.writeFile("large-text.txt", loremIpsum);
    await zip.writeFile("shakespeare.txt", shakespeareSample);
    await zip.writeFile("csv-data.csv", "id,name,email,age\n1,Alice,alice@example.com,30\n2,Bob,bob@example.com,25\n");

    await zip.commit();
    console.log("✓ Sample files created and committed");

    console.log("\n🔄 Stream Processing Examples:");

    console.log("\n--- Example 1: Basic Stream Reading ---");
    const readStream = zip.createReadStream("large-text.txt");
    let chunkCount = 0;
    let totalBytes = 0;

    readStream.on("data", (chunk) => {
      chunkCount++;
      totalBytes += chunk.length;
    });

    await new Promise<void>((resolve) => {
      readStream.on("end", () => {
        console.log(`✓ Read file in ${chunkCount} chunks (${totalBytes} bytes total)`);
        resolve();
      });

      readStream.on("error", (error) => {
        console.error("✗ Stream error:", error);
        resolve();
      });
    });

    console.log("\n--- Example 2: Transform Stream (Line Counter) ---");
    const lineStream = zip.createReadStream("large-text.txt");
    let lineCount = 0;

    const lineCounter = new Transform({
      transform(chunk: Buffer, encoding: BufferEncoding | undefined, callback) {
        const text = chunk.toString(encoding || "utf8");
        lineCount += text.split("\n").length - 1;
        this.push(chunk);
        callback();
      },
    });

    lineStream.pipe(lineCounter);

    await new Promise<void>((resolve) => {
      lineCounter.on("end", () => {
        console.log(`✓ Counted ${lineCount} lines in large-text.txt`);
        resolve();
      });

      lineCounter.on("error", (error) => {
        console.error("✗ Stream error:", error);
        resolve();
      });
    });

    console.log("\n--- Example 3: Word Count Stream ---");
    const wordStream = zip.createReadStream("shakespeare.txt");
    let wordCount = 0;

    const wordCounter = new Transform({
      transform(chunk: Buffer, encoding: BufferEncoding | undefined, callback) {
        const text = chunk.toString(encoding || "utf8");
        const words = text.match(/\b\w+\b/g);
        wordCount += words ? words.length : 0;
        this.push(chunk);
        callback();
      },
    });

    wordStream.pipe(wordCounter);

    await new Promise<void>((resolve) => {
      wordCounter.on("end", () => {
        console.log(`✓ Counted ${wordCount} words in shakespeare.txt`);
        resolve();
      });

      wordCounter.on("error", (error) => {
        console.error("✗ Stream error:", error);
        resolve();
      });
    });

    console.log("\n--- Example 4: CSV Processing ---");
    const csvStream = zip.createReadStream("csv-data.csv");
    const csvLines: string[] = [];

    const csvProcessor = new Transform({
      transform(chunk: Buffer, encoding: BufferEncoding | undefined, callback) {
        const lines = chunk.toString(encoding || "utf8").split("\n");
        csvLines.push(...lines.filter((line) => line.trim()));
        this.push(chunk);
        callback();
      },
    });

    csvStream.pipe(csvProcessor);

    await new Promise<void>((resolve) => {
      csvProcessor.on("end", () => {
        console.log(`✓ Processed CSV with ${csvLines.length} lines`);
        csvLines.slice(0, 3).forEach((line) => console.log(`    ${line}`));
        resolve();
      });

      csvProcessor.on("error", (error) => {
        console.error("✗ Stream error:", error);
        resolve();
      });
    });

    console.log("\n--- Example 5: Stream to Buffer ---");
    const bufferStream = zip.createReadStream("shakespeare.txt");
    const chunks: Buffer[] = [];

    bufferStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    await new Promise<void>((resolve) => {
      bufferStream.on("end", () => {
        const fullBuffer = Buffer.concat(chunks);
        console.log(`✓ Concatenated ${chunks.length} chunks into single buffer`);
        console.log(
          `    Total size: ${fullBuffer.length} bytes`
        );
        console.log(`    First 50 chars: ${fullBuffer.toString().slice(0, 50)}`);
        resolve();
      });

      bufferStream.on("error", (error) => {
        console.error("✗ Stream error:", error);
        resolve();
      });
    });

    console.log("\n✅ Stream processing completed!");
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
