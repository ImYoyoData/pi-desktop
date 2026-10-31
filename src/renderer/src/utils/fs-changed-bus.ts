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

export type FsChangeListener = (
  events: { path: string; kind: FsChangeKind }[],
  root: string,
) => void;

/** 渲染进程统一合并窗口：主进程已按 180ms 合并，这里只把多个订阅者收进同一批。 */
const FLUSH_DELAY_MS = 220;

const listeners = new Set<FsChangeListener>();
const pending = new Map<string, FsChangeKind>();
let pendingRoot = "";
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function cancelFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}

function flush(): void {
  flushTimer = null;
  if (!pending.size || !pendingRoot) return;
  const root = pendingRoot;
  const events = [...pending].map(([path, kind]) => ({ path, kind }));
  pending.clear();
  for (const listener of [...listeners]) listener(events, root);
}

function queueChange(payload: FsChangedPayload): void {
  pendingRoot = payload.root;
  for (const event of payload.events) pending.set(event.path, event.kind);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

/** 订阅合并后的工作区文件变更；可见性由订阅方自己决定要不要处理。 */
export function subscribeFsChanges(listener: FsChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      cancelFlush();
      pending.clear();
    }
  };
}

let off: (() => void) | null = null;

export function startFsChangedBus(): () => void {
  if (off) return off;
  const detach = window.api.fs.onChanged((payload) => {
    const workspace = useWorkspaceStore.getState();
    // 忽略上一个工作区 watcher 的迟到事件
    if (!workspace.root || !sameWorkspaceRoot(payload.root, workspace.root)) return;
    queueChange(payload);
  });
  off = () => {
    cancelFlush();
    pending.clear();
    detach();
    off = null;
  };
  return off;
}
