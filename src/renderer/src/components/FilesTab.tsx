import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, Empty, Input, Menu, Modal, Space, Spin, Typography, Tree } from "antd";
import type { MenuProps } from "antd";
import type { DataNode, EventDataNode } from "antd/es/tree";
import {
  ChevronDownOutline,
  DocumentAttachOutline,
  FolderOpenOutline,
  RefreshOutline,
  SearchOutline,
} from "@renderer/components/icons/ionicons";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { usePreviewStore } from "@renderer/stores/preview";
import { useComposerStore } from "@renderer/stores/composer";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { subscribeFsChanges } from "@renderer/utils/fs-changed-bus";
import { fileIcon } from "@renderer/utils/file-icon";
import { matchesGitIgnorePatterns } from "../../../shared/git-ignore";
import { ancestorChain } from "@renderer/utils/files-tree-expand";
import {
  encodeWorkspacePaths,
  PI_WORKSPACE_PATHS_MIME,
} from "@renderer/utils/workspace-path-dnd";
import {
  useDialog,
  useMessage,
  type DialogHandle,
} from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./FilesTab.module.css";

type FileNode = DataNode & {
  ignored?: boolean;
  children?: FileNode[];
};

type Props = {
  /** True inside the sidebar dock whose switcher already shows the title. */
  embedded?: boolean;
  /** 右侧栏不可见时先累积事件，重新可见时一次处理，避免后台反复读盘。 */
  visible?: boolean;
};

type FsEvent = { path: string; kind: "add" | "change" | "unlink" };

type CtxKind = "file" | "dir" | "blank";

/** 右键菜单距窗口边缘的最小留白。 */
const CTX_MARGIN = 8;

type CtxState = {
  show: boolean;
  x: number;
  y: number;
  path: string;
  kind: CtxKind;
};

function parentDirOf(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? "" : normalized.slice(0, idx);
}

/** Dest must be a folder path (or "" for root); never self / descendant / current parent. */
function canMoveInto(srcPath: string, destDir: string): boolean {
  const src = srcPath.replace(/\\/g, "/");
  const dest = destDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!src) return false;
  if (dest === src || dest.startsWith(`${src}/`)) return false;
  if (dest === parentDirOf(src)) return false;
  return true;
}

function findNode(nodes: FileNode[], relativePath: string): FileNode | null {
  for (const node of nodes) {
    if (String(node.key) === relativePath) return node;
    if (node.children) {
      const hit = findNode(node.children, relativePath);
      if (hit) return hit;
    }
  }
  return null;
}

function withNodeChildren(
  nodes: FileNode[],
  key: string,
  children: FileNode[] | undefined,
): FileNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (String(node.key) === key) {
      changed = true;
      return node.children === children ? node : { ...node, children };
    }
    if (node.children) {
      const updated = withNodeChildren(node.children, key, children);
      if (updated !== node.children) {
        changed = true;
        return { ...node, children: updated };
      }
    }
    return node;
  });
  return changed ? next : nodes;
}

function toFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${normalized}`;
  if (normalized.startsWith("/")) return `file://${normalized}`;
  return `file:///${normalized}`;
}

/** 按文件名过滤：命中节点连同其祖先保留。 */
function filterTree(nodes: FileNode[], query: string): FileNode[] {
  if (!query) return nodes;
  const needle = query.toLowerCase();
  const walk = (list: FileNode[]): FileNode[] => {
    const out: FileNode[] = [];
    for (const node of list) {
      const children = node.children ? walk(node.children) : undefined;
      const hit = String(node.title ?? "").toLowerCase().includes(needle);
      if (hit) out.push(node);
      else if (children?.length) out.push({ ...node, children });
    }
    return out;
  };
  return walk(nodes);
}

/** 一次遍历写回多个目录的新子项；未受影响的节点保持原引用。 */
function replaceChildren(
  nodes: FileNode[],
  updates: Map<string, FileNode[]>,
): FileNode[] {
  return nodes.map((node) => {
    const key = String(node.key);
    const fresh = updates.get(key);
    const children = node.children ? replaceChildren(node.children, updates) : node.children;
    if (fresh === undefined && children === node.children) return node;
    return { ...node, children: fresh ?? children };
  });
}

/** 新列表里仍处于展开状态的目录沿用旧子项，避免整层塌陷。 */
function mergeFreshChildren(
  previous: FileNode[] | undefined,
  fresh: FileNode[],
  expanded: string[],
): FileNode[] {
  if (!expanded.length || !previous?.length) return fresh;
  const prevByKey = new Map(
    previous.map((child) => [String(child.key), child] as const),
  );
  return fresh.map((child) => {
    if (child.isLeaf === false && expanded.includes(String(child.key))) {
      const prev = prevByKey.get(String(child.key));
      if (prev?.children) return { ...child, children: prev.children };
    }
    return child;
  });
}

function sameGitCodes(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

function samePathSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** 过滤结果需要把命中的目录都展开。 */
function dirKeysWithChildren(nodes: FileNode[]): string[] {
  const keys: string[] = [];
  for (const node of nodes) {
    if (node.isLeaf === false) {
      keys.push(String(node.key));
      if (node.children) keys.push(...dirKeysWithChildren(node.children));
    }
  }
  return keys;
}

export function FilesTab({ embedded = false, visible = true }: Props): ReactNode {
  const t = useI18n();
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const openPreview = usePreviewStore((s) => s.openPreview);
  const insertPath = useComposerStore((s) => s.insertPathRef);
  const message = useMessage();
  const dialog = useDialog();

  const [dragSrcPath, setDragSrcPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [cutPath, setCutPath] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<FileNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
  const [gitCodes, setGitCodes] = useState<Record<string, string>>({});
  const [gitDirtyDirs, setGitDirtyDirs] = useState<Set<string>>(new Set());
  const [ignoredPatterns, setIgnoredPatterns] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  const [ctx, setCtx] = useState<CtxState>({
    show: false,
    x: 0,
    y: 0,
    path: "",
    kind: "blank",
  });

  const [promptOpen, setPromptOpen] = useState(false);
  const [promptTitle, setPromptTitle] = useState("");
  const [promptValue, setPromptValue] = useState("");
  const [promptMode, setPromptMode] = useState<"file" | "dir" | "rename">("file");
  const [promptTargetDir, setPromptTargetDir] = useState("");
  const [promptRenamePath, setPromptRenamePath] = useState("");

  const treeDataRef = useRef<FileNode[]>([]);
  const expandedKeysRef = useRef<string[]>([]);
  const loadedKeysRef = useRef<string[]>([]);
  const ignoredPatternsRef = useRef<string[]>([]);
  const cutPathRef = useRef<string | null>(null);
  const dragSrcPathRef = useRef<string | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const visibleRef = useRef(visible);
  const pendingFsEventsRef = useRef(new Map<string, FsEvent["kind"]>());
  treeDataRef.current = treeData;
  expandedKeysRef.current = expandedKeys;
  loadedKeysRef.current = loadedKeys;
  ignoredPatternsRef.current = ignoredPatterns;
  cutPathRef.current = cutPath;
  dragSrcPathRef.current = dragSrcPath;
  visibleRef.current = visible;

  function toAbsolutePath(relativePath: string): string {
    const root = (useWorkspaceStore.getState().root || "").replace(/[\\/]+$/, "");
    if (!relativePath) return root;
    const sep = root.includes("\\") ? "\\" : "/";
    const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return `${root}${sep}${rel.split("/").join(sep)}`;
  }

  function labelColor(key: string, isDir: boolean): string | undefined {
    if (!isDir) {
      const code = gitCodes[key];
      return code ? gitCodeColor(code) : undefined;
    }
    return gitDirtyDirs.has(key) ? gitCodeColor("M") : undefined;
  }

  function toTreeOption(entry: { name: string; path: string; kind: "file" | "dir" }): FileNode {
    return {
      key: entry.path,
      title: entry.name,
      isLeaf: entry.kind === "file",
      ...(entry.kind === "file"
        ? { ignored: matchesGitIgnorePatterns(entry.path, ignoredPatternsRef.current) }
        : {}),
    };
  }

  function renderSuffix(node: FileNode): ReactNode {
    const key = String(node.key);
    if (node.isLeaf === false) {
      if (!gitDirtyDirs.has(key)) return null;
      return <span className={styles.gitDot} title={t.filesContainsChanges} />;
    }
    const code = gitCodes[key];
    if (!code) return null;
    return (
      <span
        className={styles.gitBadge}
        style={{ color: gitCodeColor(code) }}
        title={code}
      >
        {code}
      </span>
    );
  }

  function renderTitle(node: FileNode): ReactNode {
    const path = String(node.key);
    const isDir = node.isLeaf === false;
    const ignored = !isDir && Boolean(node.ignored);
    const icon = isDir ? null : fileIcon(path);
    return (
      <span
        className={cutPathRef.current === path ? styles.treeNodeCut : styles.treeNode}
        data-path={path}
        data-kind={isDir ? "dir" : "file"}
      >
        {isDir ? (
          <ChevronDownOutline
            size={10}
            className={styles.dirArrow}
            style={{
              transform: expandedKeysRef.current.includes(path) ? undefined : "rotate(-90deg)",
            }}
          />
        ) : (
          <span
            className="seti-tree-icon seti-file-glyph"
            style={icon?.color ? { color: icon.color } : undefined}
            aria-hidden="true"
          >
            {icon?.glyph}
          </span>
        )}
        <span
          className={ignored ? `${styles.treeLabel} ${styles.ignored}` : styles.treeLabel}
          style={
            ignored
              ? { color: "color-mix(in srgb, var(--fg-muted, #888) 78%, var(--bg, #fff))" }
              : { color: labelColor(path, isDir) }
          }
        >
          {String(node.title ?? "")}
        </span>
        {renderSuffix(node)}
      </span>
    );
  }

  async function moveIntoFolder(srcPath: string, destDir: string): Promise<boolean> {
    if (!canMoveInto(srcPath, destDir) || moving) return false;
    setMoving(true);
    try {
      await window.api.files.move(srcPath, destDir);
      message.success(t.filesMoved);
      if (cutPathRef.current === srcPath) setCutPath(null);
      await refreshRoot();
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      await refreshRoot();
      return false;
    } finally {
      setMoving(false);
    }
  }

  function clearDragState(): void {
    setDragSrcPath(null);
    setDropTargetPath(null);
  }

  async function readIgnored(): Promise<string[]> {
    try {
      return await window.api.git.ignored();
    } catch {
      return [];
    }
  }

  async function readGit(): Promise<{
    codes: Record<string, string>;
    dirs: Set<string>;
  }> {
    try {
      const status = await window.api.git.status({ stats: false });
      const codes: Record<string, string> = {};
      const dirs = new Set<string>();
      for (const f of status.files) {
        codes[f.relativePath] = f.code;
        const parts = f.relativePath.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
      return { codes, dirs };
    } catch {
      return { codes: {}, dirs: new Set<string>() };
    }
  }

  function applyGit(next: { codes: Record<string, string>; dirs: Set<string> }): void {
    setGitCodes((current) => (sameGitCodes(current, next.codes) ? current : next.codes));
    setGitDirtyDirs((current) => (samePathSet(current, next.dirs) ? current : next.dirs));
  }

  async function refreshGit(): Promise<void> {
    applyGit(await readGit());
  }

  async function loadChildren(relativePath: string): Promise<FileNode[]> {
    const entries = await window.api.files.list(relativePath || undefined);
    return entries.map(toTreeOption);
  }

  /** 并发读多个目录，供一次 setTreeData 批量写回。 */
  async function loadChildrenBatch(dirs: string[]): Promise<Map<string, FileNode[]>> {
    const unique = [...new Set(dirs)];
    if (!unique.length) return new Map();
    const lists = await Promise.all(unique.map((dir) => loadChildren(dir)));
    return new Map(unique.map((dir, index) => [dir, lists[index] ?? []] as const));
  }

  function applyChildrenBatch(updates: Map<string, FileNode[]>): void {
    if (!updates.size) return;
    const expanded = expandedKeysRef.current;
    setTreeData((current) => {
      const rootFresh = updates.get("");
      const next = rootFresh ? mergeFreshChildren(current, rootFresh, expanded) : current;
      const dirUpdates = new Map<string, FileNode[]>();
      for (const [dir, children] of updates) {
        if (!dir) continue;
        const prev = findNode(next, dir);
        dirUpdates.set(dir, mergeFreshChildren(prev?.children, children, expanded));
      }
      if (!dirUpdates.size) return next;
      return replaceChildren(next, dirUpdates);
    });
  }

  async function reloadNodeChildren(relativeDir: string): Promise<void> {
    const node = findNode(treeDataRef.current, relativeDir);
    if (!node || node.isLeaf !== false) return;
    const children = await loadChildren(relativeDir);
    applyChildrenBatch(new Map([[relativeDir, children]]));
  }

  async function refreshNode(relativeDir: string): Promise<void> {
    if (!relativeDir) {
      const fresh = await loadChildren("");
      applyChildrenBatch(new Map([["", fresh]]));
      return;
    }
    await reloadNodeChildren(relativeDir);
  }

  async function refreshRoot(): Promise<void> {
    if (!useWorkspaceStore.getState().root) {
      setTreeData([]);
      setGitCodes({});
      setGitDirtyDirs(new Set());
      setIgnoredPatterns([]);
      return;
    }
    setLoading(true);
    try {
      const expanded = [...expandedKeysRef.current];
      const [ignored, git, freshRoot, batch] = await Promise.all([
        readIgnored(),
        readGit(),
        loadChildren(""),
        loadChildrenBatch(expanded),
      ]);
      setIgnoredPatterns(ignored);
      applyGit(git);
      batch.set("", freshRoot);
      applyChildrenBatch(batch);
    } finally {
      setLoading(false);
    }
  }

  function isDirVisible(relativeDir: string): boolean {
    if (!relativeDir) return true;
    return expandedKeysRef.current.includes(relativeDir);
  }

  async function silentRefreshFromEvents(events: FsEvent[]): Promise<void> {
    if (!useWorkspaceStore.getState().root) return;
    void refreshGit();
    const parents = new Set<string>();
    for (const e of events) {
      const rel = e.path.replace(/\\/g, "/");
      if (e.kind === "unlink" && expandedKeysRef.current.includes(rel)) {
        setExpandedKeys((current) =>
          current.filter((k) => k !== rel && !k.startsWith(`${rel}/`)),
        );
      }
      if (e.kind === "change") continue;
      const parent = parentDirOf(rel);
      if (isDirVisible(parent)) parents.add(parent);
    }
    if (parents.size) applyChildrenBatch(await loadChildrenBatch([...parents]));
    await ensureExpandedNodesLoaded();
  }

  async function ensureExpandedNodesLoaded(): Promise<void> {
    const missing = [...expandedKeysRef.current].filter((key) => {
      const node = findNode(treeDataRef.current, key);
      return node !== null && node.isLeaf === false && !Array.isArray(node.children);
    });
    if (!missing.length) return;
    applyChildrenBatch(await loadChildrenBatch(missing));
  }

  async function loadData(node: EventDataNode<FileNode>): Promise<void> {
    const key = String(node.key);
    const children = await loadChildren(key);
    setTreeData((current) => withNodeChildren(current, key, children));
    setLoadedKeys((current) => (current.includes(key) ? current : [...current, key]));
  }

  function clearCachedChildren(relativeDir: string): void {
    const node = findNode(treeDataRef.current, relativeDir);
    if (!node || node.isLeaf !== false) return;
    if (node.children === undefined) return;
    setTreeData((current) => withNodeChildren(current, relativeDir, undefined));
    setLoadedKeys((current) => current.filter((k) => k !== relativeDir));
  }

  /** 把目标目录的祖先链并进已展开的键：其他已展开的目录不受影响。 */
  function ensureExpanded(dir: string): void {
    if (!dir) return;
    const prev = expandedKeysRef.current;
    const missing = ancestorChain(dir).filter((k) => !prev.includes(k));
    if (!missing.length) return;
    setExpandedKeys([...prev, ...missing]);
  }

  /** 树自己维护完整的展开键：收起的分支清掉子项缓存，再展开时重新读盘。 */
  function onExpand(nextKeys: React.Key[]): void {
    const prev = expandedKeysRef.current;
    const finalKeys = nextKeys.map(String);
    setExpandedKeys(finalKeys);
    const dropped = prev.filter((k) => !finalKeys.includes(k));
    if (!dropped.length) return;
    requestAnimationFrame(() => {
      for (const dir of dropped) clearCachedChildren(dir);
    });
  }

  /** 只广播当前文件：标签页由 RightPane 统一处理 openSignal，避免同一次点击开两遍。 */
  function openFile(filePath: string): void {
    openPreview(filePath);
  }

  function onSelect(
    keys: React.Key[],
    info: { node: EventDataNode<FileNode> },
  ): void {
    setSelectedKeys(keys.map(String));
    const node = info.node;
    if (!node || node.isLeaf === false) return;
    openFile(String(node.key));
  }

  function closeCtx(): void {
    setCtx((current) => ({ ...current, show: false }));
  }

  /** 右键菜单贴近窗口边缘时夹回可视区，避免被裁掉。 */
  useLayoutEffect(() => {
    if (!ctx.show) return;
    const el = ctxMenuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const x = Math.max(CTX_MARGIN, Math.min(ctx.x, window.innerWidth - width - CTX_MARGIN));
    const y = Math.max(CTX_MARGIN, Math.min(ctx.y, window.innerHeight - height - CTX_MARGIN));
    if (x === ctx.x && y === ctx.y) return;
    setCtx((current) => ({ ...current, x, y }));
  }, [ctx.show, ctx.x, ctx.y]);

  function openCtx(
    event: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void },
    path: string,
    kind: CtxKind,
  ): void {
    event.preventDefault?.();
    event.stopPropagation?.();
    setCtx({ show: true, x: event.clientX, y: event.clientY, path, kind });
  }

  function onTreeRightClick(info: {
    event: ReactMouseEvent;
    node: EventDataNode<FileNode>;
  }): void {
    const key = String(info.node.key);
    openCtx(
      info.event,
      key,
      info.node.isLeaf === false ? "dir" : "file",
    );
  }

  function onRootDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!dragSrcPathRef.current) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".ant-tree-node-content-wrapper")) return;
    if (!canMoveInto(dragSrcPathRef.current, "")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDropTargetPath("");
  }

  function onRootDragLeave(event: DragEvent<HTMLDivElement>): void {
    const related = event.relatedTarget as Node | null;
    const current = event.currentTarget;
    if (related && current.contains(related)) return;
    if (dropTargetPath === "") setDropTargetPath(null);
  }

  function onRootDrop(event: DragEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(".ant-tree-node-content-wrapper")) return;
    event.preventDefault();
    const src = dragSrcPathRef.current ?? event.dataTransfer?.getData("text/plain") ?? "";
    clearDragState();
    if (!src) return;
    void moveIntoFolder(src, "");
  }

  function allowTreeDrop(info: {
    dropNode: DataNode;
    dropPosition: -1 | 0 | 1;
  }): boolean {
    if (info.dropPosition !== 0) return false;
    if (info.dropNode.isLeaf !== false) return false;
    const src = dragSrcPathRef.current;
    if (!src) return true;
    return canMoveInto(src, String(info.dropNode.key));
  }

  function onTreeDragStart(info: {
    event: DragEvent<HTMLElement>;
    node: EventDataNode<FileNode>;
  }): void {
    const path = String(info.node.key);
    setDragSrcPath(path);
    setDropTargetPath(null);
    const dt = info.event.dataTransfer;
    if (!dt) return;
    dt.setData("text/plain", path);
    dt.setData(PI_WORKSPACE_PATHS_MIME, encodeWorkspacePaths([path]));
    if (useWorkspaceStore.getState().root) {
      dt.setData("text/uri-list", toFileUrl(toAbsolutePath(path)));
    }
    dt.effectAllowed = "copyMove";
  }

  function onTreeDragEnd(): void {
    clearDragState();
  }

  function onTreeDrop(info: {
    node: EventDataNode<FileNode>;
    dragNode: EventDataNode<FileNode> | null;
    dropToGap: boolean;
    event: DragEvent<HTMLElement>;
  }): void {
    info.event.preventDefault();
    const src = info.dragNode ? String(info.dragNode.key) : "";
    const dest = String(info.node.key);
    clearDragState();
    if (info.dropToGap) return;
    if (!src) return;
    if (!canMoveInto(src, dest)) return;
    void moveIntoFolder(src, dest);
  }

  const ctxItems = useMemo<MenuProps["items"]>(() => {
    const kind = ctx.kind;
    const items: MenuProps["items"] = [];
    const pasteDest =
      kind === "dir" ? ctx.path : kind === "file" ? parentDirOf(ctx.path) : "";
    const canPaste = Boolean(cutPath) && canMoveInto(cutPath!, pasteDest);

    if (kind === "file") {
      items.push(
        { label: t.open, key: "open" },
        { label: t.filesAddToChat, key: "cite" },
        { label: t.filesReveal, key: "reveal" },
        { type: "divider", key: "d0" },
        { label: t.filesCopyRelativePath, key: "copy-rel" },
        { label: t.filesCopyAbsolutePath, key: "copy-abs" },
        { type: "divider", key: "d1" },
        { label: t.filesCut, key: "cut" },
        { label: t.filesPaste, key: "paste", disabled: !canPaste },
        { type: "divider", key: "d2" },
        { label: t.filesRename, key: "rename" },
        { label: t.filesDelete, key: "delete" },
      );
    } else if (kind === "dir") {
      items.push(
        { label: t.filesNewFile, key: "new-file" },
        { label: t.filesNewFolder, key: "new-dir" },
        { label: t.filesAddToChat, key: "cite" },
        { label: t.filesReveal, key: "reveal" },
        { type: "divider", key: "d0" },
        { label: t.filesCopyRelativePath, key: "copy-rel" },
        { label: t.filesCopyAbsolutePath, key: "copy-abs" },
        { type: "divider", key: "d1" },
        { label: t.filesCut, key: "cut" },
        { label: t.filesPaste, key: "paste", disabled: !canPaste },
        { type: "divider", key: "d2" },
        { label: t.filesRename, key: "rename" },
        { label: t.filesDelete, key: "delete" },
      );
    } else {
      items.push(
        { label: t.filesNewFile, key: "new-file" },
        { label: t.filesNewFolder, key: "new-dir" },
        { label: t.filesPaste, key: "paste", disabled: !canPaste },
        { label: t.filesRefresh, key: "refresh" },
      );
    }
    return items;
  }, [ctx.kind, ctx.path, cutPath, t]);

  function openPrompt(
    mode: "file" | "dir" | "rename",
    targetDir: string,
    renamePath = "",
  ): void {
    setPromptMode(mode);
    setPromptTargetDir(targetDir);
    setPromptRenamePath(renamePath);
    if (mode === "file") {
      setPromptTitle(t.filesNewFile);
      setPromptValue("untitled.txt");
    } else if (mode === "dir") {
      setPromptTitle(t.filesNewFolder);
      setPromptValue("new-folder");
    } else {
      setPromptTitle(t.filesRename);
      setPromptValue(renamePath.split("/").pop() ?? "");
    }
    setPromptOpen(true);
  }

  async function onCtxSelect(key: string): Promise<void> {
    closeCtx();
    const action = String(key);
    const target = ctx.path;
    const kind = ctx.kind;
    try {
      switch (action) {
        case "open":
          openFile(target);
          break;
        case "cite":
          insertPath(target);
          message.success(t.filesCited);
          break;
        case "reveal":
          await window.api.files.reveal(target);
          break;
        case "copy-rel": {
          const rel = (target || ".").replace(/\\/g, "/");
          await navigator.clipboard.writeText(rel);
          message.success(t.filesRelativePathCopied);
          break;
        }
        case "copy-abs": {
          const abs = toAbsolutePath(target || "");
          await navigator.clipboard.writeText(abs);
          message.success(t.filesAbsolutePathCopied);
          break;
        }
        case "refresh":
          await refreshRoot();
          break;
        case "new-file": {
          const dir = kind === "dir" ? target : kind === "file" ? parentDirOf(target) : "";
          openPrompt("file", dir);
          break;
        }
        case "new-dir": {
          const dir = kind === "dir" ? target : kind === "file" ? parentDirOf(target) : "";
          openPrompt("dir", dir);
          break;
        }
        case "rename":
          openPrompt("rename", parentDirOf(target), target);
          break;
        case "cut":
          if (!target) break;
          setCutPath(target);
          message.success(t.filesCutReady);
          break;
        case "paste": {
          const src = cutPath;
          if (!src) {
            message.info(t.filesPasteEmpty);
            break;
          }
          const dest =
            kind === "dir" ? target : kind === "file" ? parentDirOf(target) : "";
          await moveIntoFolder(src, dest);
          break;
        }
        case "delete": {
          const d: DialogHandle = dialog.warning({
            title: t.filesDeleteConfirmTitle,
            content: t.filesDeleteConfirm(target),
            positiveText: t.delete,
            negativeText: t.cancel,
            onPositiveClick: () => {
              d.loading = true;
              return (async () => {
                try {
                  await window.api.files.delete(target);
                  message.success(t.filesDeleted);
                  await refreshNode(parentDirOf(target));
                  await refreshGit();
                  setSelectedKeys((current) => current.filter((k) => k !== target));
                  return true;
                } catch (err) {
                  message.error(err instanceof Error ? err.message : String(err));
                  d.loading = false;
                  return false;
                }
              })();
            },
          });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function submitPrompt(): Promise<boolean> {
    const name = promptValue.trim();
    if (!name) {
      message.warning(t.filesNameRequired);
      return false;
    }
    try {
      if (promptMode === "file") {
        const created = await window.api.files.createFile(promptTargetDir, name);
        if (promptTargetDir) ensureExpanded(promptTargetDir);
        await refreshNode(promptTargetDir);
        openFile(created);
      } else if (promptMode === "dir") {
        await window.api.files.createDir(promptTargetDir, name);
        if (promptTargetDir) ensureExpanded(promptTargetDir);
        await refreshNode(promptTargetDir);
      } else {
        const next = await window.api.files.rename(promptRenamePath, name);
        await refreshNode(parentDirOf(promptRenamePath));
        setSelectedKeys([next]);
      }
      setPromptOpen(false);
      await refreshGit();
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  function toolbarNewFile(): void {
    const sel = selectedKeys[0];
    let dir = "";
    if (sel) {
      const node = findNode(treeData, sel);
      dir = node?.isLeaf === false ? sel : parentDirOf(sel);
    }
    openPrompt("file", dir);
  }

  function toolbarNewDir(): void {
    const sel = selectedKeys[0];
    let dir = "";
    if (sel) {
      const node = findNode(treeData, sel);
      dir = node?.isLeaf === false ? sel : parentDirOf(sel);
    }
    openPrompt("dir", dir);
  }

  function queueFsEvents(events: FsEvent[]): void {
    if (!visibleRef.current) {
      for (const event of events) pendingFsEventsRef.current.set(event.path, event.kind);
      return;
    }
    void silentRefreshFromEvents(events);
  }

  useEffect(() => {
    void refreshRoot();
    const stop = subscribeFsChanges(queueFsEvents);
    return () => {
      stop();
      clearDragState();
    };
  }, []);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) return;
    const snapshot = pendingFsEventsRef.current;
    if (!snapshot.size) return;
    const events = [...snapshot].map(([path, kind]) => ({ path, kind }));
    snapshot.clear();
    void silentRefreshFromEvents(events);
  }, [visible]);

  const workspaceRootRef = useRef(workspaceRoot);

  useEffect(() => {
    if (workspaceRootRef.current === workspaceRoot) return;
    workspaceRootRef.current = workspaceRoot;
    setExpandedKeys([]);
    setSelectedKeys([]);
    setCutPath(null);
    clearDragState();
    void refreshRoot();
  }, [workspaceRoot]);

  useEffect(() => {
    if (!ctx.show) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (ctxMenuRef.current?.contains(event.target as Node)) return;
      closeCtx();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeCtx();
    };
    // 窗口尺寸变化后鼠标坐标已失效，菜单留在原位会错位，直接关掉。
    const onResize = (): void => closeCtx();
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [ctx.show]);

  const visibleTree = useMemo(() => filterTree(treeData, filter), [treeData, filter]);

  useEffect(() => {
    if (!filter) return;
    setExpandedKeys((prev) => {
      const merged = [...new Set([...prev, ...dirKeysWithChildren(visibleTree)])];
      return merged.length === prev.length ? prev : merged;
    });
  }, [filter, visibleTree]);

  return (
    <div className={styles.filesTab}>
      {embedded ? null : (
        <div className={styles.head}>
          <Typography.Text
            className={styles.title}
            title={workspaceRoot ?? undefined}
          >
            {t.filesTab}
          </Typography.Text>
          <Space size={2}>
            <Button
              type="text"
              shape="circle"
              size="small"
              title={t.filesRefresh}
              onClick={() => void refreshRoot()}
              icon={<RefreshOutline size={14} />}
            />
            <Button
              type="text"
              shape="circle"
              size="small"
              title={t.filesNewFile}
              onClick={toolbarNewFile}
              icon={<DocumentAttachOutline size={14} />}
            />
            <Button
              type="text"
              shape="circle"
              size="small"
              title={t.filesNewFolder}
              onClick={toolbarNewDir}
              icon={<FolderOpenOutline size={14} />}
            />
          </Space>
        </div>
      )}

      <div className={styles.searchBar}>
        <SearchOutline size={14} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          value={filter}
          type="search"
          placeholder={t.filesFilterPlaceholder}
          aria-label={t.filesFilterPlaceholder}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setFilter("");
          }}
        />
      </div>

      <div
        className={dropTargetPath === "" ? `${styles.body} ${styles.dropRoot}` : styles.body}
        onContextMenu={(event) => openCtx(event, "", "blank")}
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={onRootDrop}
      >
        {!workspaceRoot ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.filesOpenWorkspaceFirst}
          />
        ) : (
          <Spin spinning={loading} size="small">
            {visibleTree.length ? (
              <Tree<FileNode>
                blockNode
                expandAction="click"
                showIcon={false}
                draggable={{ icon: false, nodeDraggable: () => true }}
                allowDrop={allowTreeDrop}
                treeData={visibleTree}
                expandedKeys={expandedKeys}
                selectedKeys={selectedKeys}
                loadedKeys={loadedKeys}
                loadData={loadData}
                titleRender={renderTitle}
                onDragStart={onTreeDragStart}
                onDragEnd={onTreeDragEnd}
                onDrop={onTreeDrop}
                onExpand={onExpand}
                onSelect={onSelect}
                onRightClick={onTreeRightClick}
              />
            ) : !loading ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t.filesEmptyDir}
              />
            ) : null}
          </Spin>
        )}
      </div>

      {ctx.show
        ? createPortal(
            <div
              ref={ctxMenuRef}
              className={styles.ctxMenu}
              style={{ left: ctx.x, top: ctx.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Menu
                mode="vertical"
                items={ctxItems}
                onClick={({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  void onCtxSelect(key);
                }}
              />
            </div>,
            document.body,
          )
        : null}

      <Modal
        open={promptOpen}
        title={promptTitle}
        okText={t.confirm}
        cancelText={t.cancel}
        onOk={() => void submitPrompt()}
        onCancel={() => setPromptOpen(false)}
      >
        <Input
          size="small"
          autoFocus
          value={promptValue}
          onChange={(event) => setPromptValue(event.target.value)}
          onPressEnter={() => void submitPrompt()}
        />
      </Modal>
    </div>
  );
}

export default FilesTab;
