import * as path from "path";
import * as yauzl from "yauzl";

// ============================================================================
// Path Normalization & Validation
// ============================================================================

export function normalizePath(p: string): string {
  // Strip leading slash, normalize separators, reject absolute paths
  if (path.isAbsolute(p)) {
    throw new Error(`Absolute paths not allowed: ${p}`);
  }

  let normalized = p.replace(/\\/g, "/").replace(/^\/+/, "");

  // Reject .. traversal
  if (normalized.includes("..")) {
    throw new Error(`Path traversal (..) not allowed: ${p}`);
  }

  // Validate via yauzl
  const err = yauzl.validateFileName(normalized);
  if (err !== null) {
    throw new Error(err);
  }

  return normalized;
}
