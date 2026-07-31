/** DnD payload: workspace-relative paths from the Files tree → composer file tags. */
export const PI_WORKSPACE_PATHS_MIME = "application/x-pi-workspace-paths";

/** Encode one or more workspace-relative paths for DataTransfer. */
export function encodeWorkspacePaths(paths: string[]): string {
  const cleaned = paths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "").trim()).filter(Boolean);
  return JSON.stringify(cleaned);
}

/** Decode custom MIME or fall back to newline / plain text paths. */
export function decodeWorkspacePaths(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((p): p is string => typeof p === "string")
          .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "").trim())
          .filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
    .filter(Boolean);
}

/**
 * True when the string looks like a workspace-relative path (not a URL / absolute).
 * Used when dragging from the Files tree with text/plain = relative key.
 */
export function looksLikeWorkspaceRelPath(raw: string): boolean {
  const t = raw.trim().replace(/\\/g, "/");
  if (!t || t.includes("\0")) return false;
  if (/^https?:\/\//i.test(t) || /^file:\/\//i.test(t)) return false;
  if (/^[A-Za-z]:\//.test(t) || t.startsWith("//") || t.startsWith("/")) return false;
  // Reject prose with spaces that isn't a quoted path — allow normal rel paths with spaces.
  if (t.includes("://")) return false;
  return true;
}
