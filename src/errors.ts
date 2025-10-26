// ============================================================================
// Errors (Node-like)
// ============================================================================

export class FSError extends Error {
  constructor(public code: string, public path: string, message: string) {
    super(message);
    this.name = "FSError";
  }
}

export function enoent(p: string): FSError {
  return new FSError(
    "ENOENT",
    p,
    `ENOENT: no such file or directory, open '${p}'`
  );
}

export function eisdir(p: string): FSError {
  return new FSError(
    "EISDIR",
    p,
    `EISDIR: illegal operation on a directory, open '${p}'`
  );
}

export function enotdir(p: string): FSError {
  return new FSError("ENOTDIR", p, `ENOTDIR: not a directory, open '${p}'`);
}

export function eexist(p: string): FSError {
  return new FSError("EEXIST", p, `EEXIST: file already exists, open '${p}'`);
}
