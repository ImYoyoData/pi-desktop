import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../shared/path-sandbox";

const SKIP = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "out",
  ".next",
  "coverage",
  "__pycache__",
  ".turbo",
  ".cache",
]);

export type WorkspaceDirEntry = {
  name: string;
  /** Relative path using `/` separators */
  path: string;
  kind: "file" | "dir";
};

function toRel(relative: string, name: string): string {
  const rel = relative ? `${relative.replace(/\\/g, "/")}/${name}` : name;
  return rel.replace(/\\/g, "/");
}

export function listWorkspaceDir(root: string, relative = ""): WorkspaceDirEntry[] {
  const abs = relative ? resolveWorkspacePath(root, relative) : path.resolve(root);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return [];
  }
  const names = fs.readdirSync(abs);
  const entries: WorkspaceDirEntry[] = [];
  for (const name of names) {
    if (SKIP.has(name) || name === "." || name === "..") continue;
    if (name.startsWith(".") && name !== ".gitignore" && name !== ".env" && name !== ".npmrc") {
      if (name !== ".editorconfig" && name !== ".prettierrc") continue;
    }
    const childAbs = path.join(abs, name);
    let kind: "file" | "dir";
    try {
      kind = fs.statSync(childAbs).isDirectory() ? "dir" : "file";
    } catch {
      continue;
    }
    entries.push({ name, path: toRel(relative, name), kind });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return entries;
}

function assertSafeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("名称不能为空");
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    throw new Error("名称不能包含路径分隔符");
  }
  return trimmed;
}

export function createWorkspaceFile(root: string, relativeDir: string, name: string): string {
  const safe = assertSafeName(name);
  const dirAbs = relativeDir ? resolveWorkspacePath(root, relativeDir) : path.resolve(root);
  fs.mkdirSync(dirAbs, { recursive: true });
  const abs = path.join(dirAbs, safe);
  resolveWorkspacePath(root, path.relative(root, abs));
  if (fs.existsSync(abs)) throw new Error("已存在同名文件");
  fs.writeFileSync(abs, "", "utf8");
  return toRel(relativeDir, safe);
}

export function createWorkspaceDir(root: string, relativeDir: string, name: string): string {
  const safe = assertSafeName(name);
  const dirAbs = relativeDir ? resolveWorkspacePath(root, relativeDir) : path.resolve(root);
  fs.mkdirSync(dirAbs, { recursive: true });
  const abs = path.join(dirAbs, safe);
  resolveWorkspacePath(root, path.relative(root, abs));
  if (fs.existsSync(abs)) throw new Error("已存在同名文件夹");
  fs.mkdirSync(abs);
  return toRel(relativeDir, safe);
}

export function renameWorkspaceEntry(root: string, relativePath: string, newName: string): string {
  const safe = assertSafeName(newName);
  const abs = resolveWorkspacePath(root, relativePath);
  const parent = path.dirname(abs);
  const nextAbs = path.join(parent, safe);
  resolveWorkspacePath(root, path.relative(root, nextAbs));
  if (fs.existsSync(nextAbs)) throw new Error("目标名称已存在");
  fs.renameSync(abs, nextAbs);
  const parentRel = path.dirname(relativePath.replace(/\\/g, "/"));
  const parentKey = parentRel === "." ? "" : parentRel;
  return toRel(parentKey, safe);
}

/** Move a file/folder into another directory (same basename). */
export function moveWorkspaceEntry(
  root: string,
  relativePath: string,
  destRelativeDir: string,
): string {
  const abs = resolveWorkspacePath(root, relativePath);
  const base = path.basename(abs);
  const fromNorm = relativePath.replace(/\\/g, "/");
  const destNorm = (destRelativeDir || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (destNorm === fromNorm || destNorm.startsWith(`${fromNorm}/`)) {
    throw new Error("不能移动到自身或其子目录");
  }
  const destDirAbs = destNorm
    ? resolveWorkspacePath(root, destNorm)
    : path.resolve(root);
  if (!fs.existsSync(destDirAbs) || !fs.statSync(destDirAbs).isDirectory()) {
    throw new Error("目标目录不存在");
  }
  const nextAbs = path.join(destDirAbs, base);
  resolveWorkspacePath(root, path.relative(root, nextAbs));
  if (path.resolve(abs) === path.resolve(nextAbs)) return fromNorm;
  if (fs.existsSync(nextAbs)) throw new Error("目标位置已存在同名项");
  fs.renameSync(abs, nextAbs);
  return toRel(destNorm, base);
}

export function deleteWorkspaceEntry(root: string, relativePath: string): void {
  const abs = resolveWorkspacePath(root, relativePath);
  fs.rmSync(abs, { recursive: true, force: false });
}
