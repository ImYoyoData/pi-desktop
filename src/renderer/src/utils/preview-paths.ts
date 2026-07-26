const PREVIEWABLE = /\.(md|markdown|ts|tsx|js|jsx|json|vue|css|html|txt|yaml|yml|png|jpe?g|gif|webp)$/i;

const PATH_KEYS = new Set(["path", "file_path", "filePath", "target", "file"]);

function normalizeWorkspacePath(raw: string): string {
  let p = raw.trim().replace(/\\/g, "/");
  while (p.startsWith("./")) {
    p = p.slice(2);
  }
  return p;
}

function isWorkspaceRelativePath(raw: string): boolean {
  const p = normalizeWorkspacePath(raw);
  if (!p || p.includes("://") || pathLooksAbsolute(p)) {
    return false;
  }
  if (p.split("/").includes("..")) {
    return false;
  }
  return PREVIEWABLE.test(p) || p.includes("/");
}

function pathLooksAbsolute(p: string): boolean {
  if (p.startsWith("/")) {
    return true;
  }
  return /^[a-zA-Z]:/.test(p);
}

function considerPath(raw: string, out: Set<string>): void {
  if (!isWorkspaceRelativePath(raw)) {
    return;
  }
  out.add(normalizeWorkspacePath(raw));
}

function walk(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    considerPath(value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, out);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PATH_KEYS.has(key) && typeof child === "string") {
        considerPath(child, out);
      } else {
        walk(child, out);
      }
    }
  }
}

export function extractWorkspacePaths(payload: unknown): string[] {
  const found = new Set<string>();
  walk(payload, found);
  return [...found];
}
