/**
 * Shared workspace git filter matcher (exact file or folder prefix).
 */
export function matchesGitIgnorePatterns(
  relativePath: string,
  patterns: string[],
): boolean {
  const rel = (relativePath ?? "").replace(/\\/g, "/").replace(/^\//, "");
  if (!rel) return false;
  return (patterns ?? []).some((raw) => {
    const p = (raw ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return Boolean(p) && (rel === p || rel.startsWith(`${p}/`));
  });
}
