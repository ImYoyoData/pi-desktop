/** Basename of a workspace-relative or absolute path. */
export function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

/**
 * VS Code–style unique tab title: basename when unique among open tabs,
 * otherwise the shortest parent…/name suffix that disambiguates.
 */
export function uniquePreviewTabLabel(filePath: string, openPaths: string[]): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) return filePath || "file";

  const base = parts[parts.length - 1]!;
  const others = openPaths
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p !== normalized);

  const sameBase = others.filter((p) => pathBasename(p) === base);
  if (!sameBase.length) return base;

  for (let depth = 1; depth < parts.length; depth++) {
    const candidate = parts.slice(-(depth + 1)).join("/");
    const conflict = sameBase.some((p) => {
      const op = p.split("/").filter(Boolean);
      return op.slice(-(depth + 1)).join("/") === candidate;
    });
    if (!conflict) return candidate;
  }
  return normalized;
}
