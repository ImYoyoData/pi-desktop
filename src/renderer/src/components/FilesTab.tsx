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
  DocumentAttachOutline,
  FolderOpenOutline,
  FolderOutline,
  RefreshOutline,
} from "@renderer/components/icons/ionicons";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";
import { useComposerStore } from "@renderer/stores/composer";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import type { FsChangedPayload } from "@renderer/utils/fs-changed-bus";
import { fileIcon } from "@renderer/utils/file-icon";
import { matchesGitIgnorePatterns } from "../../../shared/git-ignore";
import { ancestorChain, nextExpandedKeys } from "@renderer/utils/files-tree-expand";
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
};

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

export function FilesTab({ embedded = false }: Props): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const previewStore = usePreviewStore();
  const composer = useComposerStore();
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
  const fsRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFsEventsRef = useRef<
    { path: string; kind: "add" | "change" | "unlink" }[]
  >([]);
  treeDataRef.current = treeData;
  expandedKeysRef.current = expandedKeys;
  loadedKeysRef.current = loadedKeys;
  ignoredPatternsRef.current = ignoredPatterns;
  cutPathRef.current = cutPath;
  dragSrcPathRef.current = dragSrcPath;

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
          <span
            className="seti-tree-icon"
            style={{ color: labelColor(path, true) }}
          >
            <FolderOutline size={13} />
          </span>
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

  async function refreshIgnored(): Promise<void> {
    try {
      setIgnoredPatterns(await window.api.git.ignored());
    } catch {
      setIgnoredPatterns([]);
    }
  }

  async function refreshGit(): Promise<void> {
    try {
      const status = await window.api.git.status();
      const map: Record<string, string> = {};
      const dirs = new Set<string>();
      for (const f of status.files) {
        map[f.relativePath] = f.code;
        const parts = f.relativePath.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirs.add(parts.slice(0, i).join("/"));
        }
      }
      setGitCodes(map);
      setGitDirtyDirs(dirs);
    } catch {
      setGitCodes({});
      setGitDirtyDirs(new Set());
    }
  }

  async function loadChildren(relativePath: string): Promise<FileNode[]> {
    const entries = await window.api.files.list(relativePath || undefined);
    return entries.map(toTreeOption);
  }

  function mergeChildren(
    current: FileNode[],
    dirKey: string,
    fresh: FileNode[],
    expanded: string[],
  ): FileNode[] {
    const existing = findNode(current, dirKey);
    const prevByKey = new Map(
      (existing?.children ?? []).map((child) => [String(child.key), child] as const),
    );
    const merged = fresh.map((child) => {
      if (child.isLeaf === false && expanded.includes(String(child.key))) {
        const prev = prevByKey.get(String(child.key));
        if (prev?.children) return { ...child, children: prev.children };
      }
      return child;
    });
    return withNodeChildren(current, dirKey, merged);
  }

  async function reloadNodeChildren(relativeDir: string): Promise<void> {
    const node = findNode(treeDataRef.current, relativeDir);
    if (!node || node.isLeaf !== false) return;
    const children = await loadChildren(relativeDir);
    const expanded = expandedKeysRef.current;
    setTreeData((current) => mergeChildren(current, relativeDir, children, expanded));
  }

  async function refreshNode(relativeDir: string): Promise<void> {
    if (!relativeDir) {
      const fresh = await loadChildren("");
      const expanded = expandedKeysRef.current;
      setTreeData((current) => {
        const prevByKey = new Map(
          current.map((node) => [String(node.key), node] as const),
        );
        const merged = fresh.map((node) => {
          if (node.isLeaf === false && expanded.includes(String(node.key))) {
            const prev = prevByKey.get(String(node.key));
            if (prev?.children) return { ...node, children: prev.children };
          }
          return node;
        });
        return merged;
      });
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
      await refreshIgnored();
      await refreshGit();
      const root = await loadChildren("");
      setTreeData(root);
      for (const key of [...expandedKeysRef.current]) {
        await reloadNodeChildren(key);
      }
    } finally {
      setLoading(false);
    }
  }

  function isDirVisible(relativeDir: string): boolean {
    if (!relativeDir) return true;
    return expandedKeysRef.current.includes(relativeDir);
  }

  async function silentRefreshFromEvents(
    events: { path: string; kind: "add" | "change" | "unlink" }[],
  ): Promise<void> {
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
    if (!parents.size) return;
    for (const dir of parents) {
      if (!dir) {
        await refreshNode("");
        continue;
      }
      await reloadNodeChildren(dir);
    }
    await ensureExpandedNodesLoaded();
  }

  async function ensureExpandedNodesLoaded(): Promise<void> {
    for (const key of [...expandedKeysRef.current]) {
      const node = findNode(treeDataRef.current, key);
      if (node && node.isLeaf === false && !Array.isArray(node.children)) {
        await reloadNodeChildren(key);
      }
    }
  }

  function scheduleFsRefresh(
    events: { path: string; kind: "add" | "change" | "unlink" }[],
  ): void {
    pendingFsEventsRef.current.push(...events);
    if (fsRefreshTimerRef.current) clearTimeout(fsRefreshTimerRef.current);
    fsRefreshTimerRef.current = setTimeout(() => {
      fsRefreshTimerRef.current = null;
      const batch = pendingFsEventsRef.current;
      pendingFsEventsRef.current = [];
      void silentRefreshFromEvents(batch);
    }, 250);
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

  function ensureExpanded(dir: string): void {
    if (!dir) return;
    const chain = ancestorChain(dir);
    const prev = expandedKeysRef.current;
    setExpandedKeys(chain);
    const dropped = prev.filter((k) => !chain.includes(k));
    if (!dropped.length) return;
    requestAnimationFrame(() => {
      for (const d of dropped) clearCachedChildren(d);
    });
  }

  function onExpand(nextKeys: React.Key[]): void {
    const prev = expandedKeysRef.current;
    const finalKeys = nextExpandedKeys(prev, nextKeys.map(String));
    setExpandedKeys(finalKeys);
    const dropped = prev.filter((k) => !finalKeys.includes(k));
    if (!dropped.length) return;
    requestAnimationFrame(() => {
      for (const dir of dropped) clearCachedChildren(dir);
    });
  }

  function openFile(filePath: string): void {
    previewStore.openPreview(filePath);
    useRightTabsStore.getState().addTab("preview", {
      filePath,
      label: filePath.split(/[/\\]/).pop() ?? t.preview,
    });
    if (useLayoutStore.getState().rightCollapsed) {
      useLayoutStore.getState().toggleRightCollapsed();
    }
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
          composer.insertPathRef(target);
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

  function onWorkspaceFsChanged(event: Event): void {
    const detail = (event as CustomEvent<FsChangedPayload>).detail;
    scheduleFsRefresh(detail?.events ?? []);
  }

  useEffect(() => {
    void refreshRoot();
    window.addEventListener("pi-fs-changed", onWorkspaceFsChanged);
    return () => {
      window.removeEventListener("pi-fs-changed", onWorkspaceFsChanged);
      if (fsRefreshTimerRef.current) clearTimeout(fsRefreshTimerRef.current);
      clearDragState();
    };
  }, []);

  const workspaceRootRef = useRef(workspace.root);

  useEffect(() => {
    if (workspaceRootRef.current === workspace.root) return;
    workspaceRootRef.current = workspace.root;
    setExpandedKeys([]);
    setSelectedKeys([]);
    setCutPath(null);
    clearDragState();
    void refreshRoot();
  }, [workspace.root]);

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

  return (
    <div className={styles.filesTab}>
      <div className={styles.head}>
        {embedded ? (
          <span className={styles.title} title={workspace.root ?? undefined} />
        ) : (
          <Typography.Text
            className={styles.title}
            title={workspace.root ?? undefined}
          >
            {t.filesTab}
          </Typography.Text>
        )}
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

      <div
        className={dropTargetPath === "" ? `${styles.body} ${styles.dropRoot}` : styles.body}
        onContextMenu={(event) => openCtx(event, "", "blank")}
        onDragOver={onRootDragOver}
        onDragLeave={onRootDragLeave}
        onDrop={onRootDrop}
      >
        {!workspace.root ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t.filesOpenWorkspaceFirst}
          />
        ) : (
          <Spin spinning={loading} size="small">
            {treeData.length ? (
              <Tree<FileNode>
                blockNode
                expandAction="click"
                showIcon={false}
                draggable
                allowDrop={allowTreeDrop}
                treeData={treeData}
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
