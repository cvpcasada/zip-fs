import * as yauzl from "yauzl";
import { Readable } from "stream";

// ============================================================================
// Utilities
// ============================================================================

export function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", reject);
  });
}

export function openReadStreamFromYauzl(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry
): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, readStream) => {
      if (err) reject(err);
      else resolve(readStream);
    });
  });
}

export async function promiseFs<T>(
  fn: (
    callback: (err: NodeJS.ErrnoException | null, result?: T) => void
  ) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) reject(err);
      else resolve(result!);
    });
  });
}
