/**
 * 全局唯一的文件系统变更订阅：主进程 fs:changed → 渲染进程 pi-fs-changed。
 * 订阅跟随应用生命周期，不依赖文件树等面板是否挂载。
 */
import { useWorkspaceStore } from "@renderer/stores/workspace";

export type FsChangeKind = "add" | "change" | "unlink";

export type FsChangedPayload = {
  root: string;
  events: { path: string; kind: FsChangeKind }[];
};

/** 与主进程 fs-watch-host 的 rootsEqual 对齐：仅 Windows 折叠大小写。 */
let pathCaseInsensitive = false;
void window.api.window.platform().then((p) => {
  pathCaseInsensitive = p === "win32";
});

export function normalizeFsPath(p: string): string {
  const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return pathCaseInsensitive ? n.toLowerCase() : n;
}

export function sameWorkspaceRoot(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

/** 路径是否位于工作区内（含根目录本身）。 */
export function isInsideWorkspace(root: string, p: string): boolean {
  if (!root) return false;
  const base = normalizeFsPath(root);
  const abs = normalizeFsPath(absoluteWorkspacePath(root, p));
  return abs === base || abs.startsWith(`${base}/`);
}

/** 是否为绝对路径（Windows 盘符或 POSIX 根）。 */
export function isAbsoluteFsPath(p: string): boolean {
  const raw = p.replace(/\\/g, "/");
  return raw.startsWith("/") || /^[a-zA-Z]:\//.test(raw);
}

/** fs 事件是工作区相对路径，标签页可能存绝对路径——统一成绝对路径再比较。 */
export function absoluteWorkspacePath(root: string, p: string): string {
  const raw = p.replace(/\\/g, "/");
  if (isAbsoluteFsPath(raw)) return raw;
  return `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${raw}`;
}

let off: (() => void) | null = null;

export function startFsChangedBus(): () => void {
  if (off) return off;
  const detach = window.api.fs.onChanged((payload) => {
    const workspace = useWorkspaceStore();
    // 忽略上一个工作区 watcher 的迟到事件
    if (!workspace.root || !sameWorkspaceRoot(payload.root, workspace.root)) return;
    window.dispatchEvent(
      new CustomEvent<FsChangedPayload>("pi-fs-changed", { detail: payload }),
    );
  });
  off = () => {
    detach();
    off = null;
  };
  return off;
}
