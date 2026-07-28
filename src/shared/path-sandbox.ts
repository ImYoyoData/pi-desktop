import path from "node:path";

function foldPath(p: string, caseInsensitive: boolean): string {
  const normalized = path.normalize(p);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

/** macOS APFS is usually case-insensitive; Windows always is. */
function platformCaseInsensitive(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" || platform === "darwin";
}

export function isPathInsideRoot(
  root: string,
  candidate: string,
  caseInsensitive: boolean = platformCaseInsensitive(),
): boolean {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const rootFold = foldPath(rootResolved, caseInsensitive);
  const candidateFold = foldPath(candidateResolved, caseInsensitive);
  const rel = path.relative(rootFold, candidateFold);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveWorkspacePath(
  root: string,
  relativeOrAbsolute: string,
  caseInsensitive: boolean = platformCaseInsensitive(),
): string {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, relativeOrAbsolute);
  if (!isPathInsideRoot(rootResolved, candidate, caseInsensitive)) {
    throw new Error(`Path escapes workspace root: ${relativeOrAbsolute}`);
  }
  // Return the resolve() result with original casing from candidate when possible.
  return candidate;
}
