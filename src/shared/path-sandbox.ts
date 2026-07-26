import path from "node:path";

export function resolveWorkspacePath(root: string, relativeOrAbsolute: string): string {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, relativeOrAbsolute);
  if (!isPathInsideRoot(rootResolved, candidate)) {
    throw new Error(`Path escapes workspace root: ${relativeOrAbsolute}`);
  }
  return candidate;
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const rel = path.relative(rootResolved, candidateResolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
