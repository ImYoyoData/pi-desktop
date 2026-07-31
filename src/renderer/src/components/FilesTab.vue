<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { DropdownOption, TreeOption } from "naive-ui";
import {
  NButton,
  NDropdown,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NSpin,
  NText,
  NTree,
  useDialog,
  useMessage,
} from "naive-ui";
import {
  ChatbubbleEllipsesOutline,
  DocumentOutline,
  FolderOutline,
  RefreshOutline,
  DocumentAttachOutline,
  FolderOpenOutline,
} from "@vicons/ionicons5";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";
import { useComposerStore } from "@renderer/stores/composer";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { ancestorChain, nextExpandedKeys } from "@renderer/utils/files-tree-expand";
import { t } from "@renderer/i18n";

const workspace = useWorkspaceStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const layout = useLayoutStore();
const composer = useComposerStore();
const message = useMessage();
const dialog = useDialog();

let offFs: (() => void) | null = null;
/** Match main `fs-watch-host` rootsEqual: only Windows folds case. */
let pathCaseInsensitive = false;
void window.api.window.platform().then((p) => {
  pathCaseInsensitive = p === "win32";
});

/** Drag source for move-into-folder (not sibling reorder). */
const dragSrcPath = ref<string | null>(null);
/** Highlighted drop folder ("" = workspace root blank area). */
const dropTargetPath = ref<string | null>(null);
const moving = ref(false);
/** Path pending cut → paste (cleared after successful move). */
const cutPath = ref<string | null>(null);

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

async function moveIntoFolder(srcPath: string, destDir: string): Promise<boolean> {
  if (!canMoveInto(srcPath, destDir) || moving.value) return false;
  moving.value = true;
  try {
    await window.api.files.move(srcPath, destDir);
    message.success(t.filesMoved);
    if (cutPath.value === srcPath) cutPath.value = null;
    await refreshRoot();
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    await refreshRoot();
    return false;
  } finally {
    moving.value = false;
  }
}

function clearDragState(): void {
  dragSrcPath.value = null;
  dropTargetPath.value = null;
}

function onRootDragOver(e: DragEvent): void {
  if (!dragSrcPath.value) return;
  // Only treat empty body / padding as root; folder nodes handle themselves.
  const target = e.target as HTMLElement | null;
  if (target?.closest?.(".n-tree-node-content")) return;
  if (!canMoveInto(dragSrcPath.value, "")) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  dropTargetPath.value = "";
}

function onRootDragLeave(e: DragEvent): void {
  const related = e.relatedTarget as Node | null;
  const current = e.currentTarget as HTMLElement;
  if (related && current.contains(related)) return;
  if (dropTargetPath.value === "") dropTargetPath.value = null;
}

function onRootDrop(e: DragEvent): void {
  const target = e.target as HTMLElement | null;
  if (target?.closest?.(".n-tree-node-content")) return;
  e.preventDefault();
  const src = dragSrcPath.value ?? e.dataTransfer?.getData("text/plain") ?? "";
  clearDragState();
  if (!src) return;
  void moveIntoFolder(src, "");
}

type DropPosition = "before" | "after" | "inside";

/** Only allow drop *inside* directories (never sibling reorder). */
function allowTreeDrop(info: {
  node: TreeOption;
  dropPosition: DropPosition;
  phase: "drag" | "drop";
}): boolean {
  if (info.dropPosition !== "inside") return false;
  if (info.node.isLeaf !== false) return false;
  const src = dragSrcPath.value;
  // dragSrcPath may lag one tick behind Naive's internal drag node — still show mark.
  if (!src) return true;
  return canMoveInto(src, String(info.node.key));
}

function onTreeDragStart(info: { node: TreeOption; event: DragEvent }): void {
  const path = String(info.node.key);
  dragSrcPath.value = path;
  dropTargetPath.value = null;
  info.event.dataTransfer?.setData("text/plain", path);
  if (info.event.dataTransfer) info.event.dataTransfer.effectAllowed = "move";
}

function onTreeDragEnd(): void {
  clearDragState();
}

function onTreeDrop(info: {
  node: TreeOption;
  dragNode: TreeOption;
  dropPosition: DropPosition;
  event: DragEvent;
}): void {
  info.event.preventDefault();
  const src = String(info.dragNode.key);
  const dest = String(info.node.key);
  clearDragState();
  if (info.dropPosition !== "inside") return;
  if (!canMoveInto(src, dest)) return;
  void moveIntoFolder(src, dest);
}

function sameWorkspaceRoot(a: string, b: string): boolean {
  const fold = (p: string) => {
    const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
    // Only Windows folds case (macOS APFS may be case-sensitive).
    return pathCaseInsensitive ? n.toLowerCase() : n;
  };
  const na = fold(a);
  const nb = fold(b);
  return na === nb;
}

const loading = ref(false);
const treeData = ref<TreeOption[]>([]);
const expandedKeys = ref<string[]>([]);
const selectedKeys = ref<string[]>([]);
/** relativePath -> git code */
const gitCodes = ref<Record<string, string>>({});
const gitDirtyDirs = ref<Set<string>>(new Set());

const ctx = ref({
  show: false,
  x: 0,
  y: 0,
  path: "" as string,
  kind: "blank" as "file" | "dir" | "blank",
});

const promptOpen = ref(false);
const promptTitle = ref("");
const promptValue = ref("");
const promptMode = ref<"file" | "dir" | "rename">("file");
const promptTargetDir = ref("");
const promptRenamePath = ref("");

function renderPrefix({ option }: { option: TreeOption }) {
  const isDir = option.isLeaf === false;
  return h(NIcon, {
    component: isDir ? FolderOutline : DocumentOutline,
    size: 13,
    style: { color: labelColor(String(option.key), isDir) },
  });
}

function labelColor(key: string, isDir: boolean): string | undefined {
  if (!isDir) {
    const code = gitCodes.value[key];
    return code ? gitCodeColor(code) : undefined;
  }
  return gitDirtyDirs.value.has(key) ? gitCodeColor("M") : undefined;
}

function renderSuffix({ option }: { option: TreeOption }) {
  if (option.isLeaf === false) {
    if (!gitDirtyDirs.value.has(String(option.key))) return null;
    return h("span", { class: "git-dot", title: t.filesContainsChanges });
  }
  const code = gitCodes.value[String(option.key)];
  if (!code) return null;
  return h(
    "span",
    {
      class: "git-badge",
      style: { color: gitCodeColor(code) },
      title: code,
    },
    code,
  );
}

function renderLabel({ option }: { option: TreeOption }) {
  const isDir = option.isLeaf === false;
  return h(
    "span",
    {
      class: "tree-label",
      style: { color: labelColor(String(option.key), isDir) },
    },
    String(option.label ?? ""),
  );
}

function toTreeOption(entry: { name: string; path: string; kind: "file" | "dir" }): TreeOption {
  return {
    key: entry.path,
    label: entry.name,
    isLeaf: entry.kind === "file",
  };
}

function findTreeNode(nodes: TreeOption[], relativePath: string): TreeOption | null {
  for (const n of nodes) {
    if (String(n.key) === relativePath) return n;
    if (n.children) {
      const hit = findTreeNode(n.children, relativePath);
      if (hit) return hit;
    }
  }
  return null;
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
    gitCodes.value = map;
    gitDirtyDirs.value = dirs;
  } catch {
    gitCodes.value = {};
    gitDirtyDirs.value = new Set();
  }
}

async function loadChildren(relativePath: string): Promise<TreeOption[]> {
  const entries = await window.api.files.list(relativePath || undefined);
  return entries.map(toTreeOption);
}

async function refreshRoot(): Promise<void> {
  if (!workspace.root) {
    treeData.value = [];
    gitCodes.value = {};
    gitDirtyDirs.value = new Set();
    return;
  }
  loading.value = true;
  try {
    await refreshGit();
    treeData.value = await loadChildren("");
    // Only rehydrate currently expanded dirs (accordion = one branch), one level each.
    for (const key of [...expandedKeys.value]) {
      await reloadNodeChildren(key);
    }
  } finally {
    loading.value = false;
  }
}

async function reloadNodeChildren(relativeDir: string): Promise<void> {
  const node = findTreeNode(treeData.value, relativeDir);
  if (!node || node.isLeaf !== false) return;
  const children = await loadChildren(relativeDir);
  // Preserve already-loaded children of still-expanded immediate children (one layer only).
  const prevByKey = new Map(
    (node.children ?? []).map((c) => [String(c.key), c] as const),
  );
  for (const child of children) {
    if (child.isLeaf === false && expandedKeys.value.includes(String(child.key))) {
      const prev = prevByKey.get(String(child.key));
      if (prev?.children) child.children = prev.children;
    }
  }
  node.children = children;
  treeData.value = [...treeData.value];
}

/** If an expanded dir lost its children (refresh race), load one layer again. */
async function ensureExpandedNodesLoaded(): Promise<void> {
  for (const key of [...expandedKeys.value]) {
    const node = findTreeNode(treeData.value, key);
    if (node && node.isLeaf === false && !Array.isArray(node.children)) {
      await reloadNodeChildren(key);
    }
  }
}

/** True if this directory's children are currently shown in the tree. */
function isDirVisible(relativeDir: string): boolean {
  if (!relativeDir) return true;
  return expandedKeys.value.includes(relativeDir);
}

/**
 * Silent watch refresh: only reload parents that are currently visible.
 * Closed subtrees are left alone (lazy-loaded when the user expands them).
 * Content-only "change" events do not re-list directories (names unchanged).
 */
async function silentRefreshFromEvents(
  events: { path: string; kind: "add" | "change" | "unlink" }[],
): Promise<void> {
  if (!workspace.root) return;
  void refreshGit();
  const parents = new Set<string>();
  for (const e of events) {
    const rel = e.path.replace(/\\/g, "/");
    // If an expanded dir itself disappeared, drop it from expanded keys.
    if (e.kind === "unlink" && expandedKeys.value.includes(rel)) {
      expandedKeys.value = expandedKeys.value.filter(
        (k) => k !== rel && !k.startsWith(`${rel}/`),
      );
    }
    // File content change: list entries unchanged — skip tree reload.
    if (e.kind === "change") continue;
    const parent = parentDirOf(rel);
    if (isDirVisible(parent)) parents.add(parent);
  }
  if (!parents.size) return;
  for (const dir of parents) {
    if (!dir) {
      const fresh = await loadChildren("");
      const prevByKey = new Map(treeData.value.map((n) => [String(n.key), n] as const));
      for (const opt of fresh) {
        if (opt.isLeaf === false && expandedKeys.value.includes(String(opt.key))) {
          const prev = prevByKey.get(String(opt.key));
          if (prev?.children) opt.children = prev.children;
        }
      }
      treeData.value = fresh;
      continue;
    }
    await reloadNodeChildren(dir);
  }
  await ensureExpandedNodesLoaded();
}

/** Debounced tree refresh from filesystem watcher — silent, visible dirs only. */
let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFsEvents: { path: string; kind: "add" | "change" | "unlink" }[] = [];
function scheduleFsRefresh(
  events: { path: string; kind: "add" | "change" | "unlink" }[],
): void {
  pendingFsEvents.push(...events);
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  fsRefreshTimer = setTimeout(() => {
    fsRefreshTimer = null;
    const batch = pendingFsEvents;
    pendingFsEvents = [];
    void silentRefreshFromEvents(batch);
  }, 250);
}

async function onLoad(option: TreeOption): Promise<void> {
  const key = String(option.key);
  const children = await loadChildren(key);
  // Always write to the live tree node — option may be stale after a silent refresh
  // replaced `treeData` while this load was in flight.
  const live = findTreeNode(treeData.value, key) ?? option;
  live.children = children;
  if (live !== option) option.children = children;
}

/**
 * Drop cached children so the next expand triggers on-load (fresh one layer).
 * Mutate in place only — replacing `treeData` clears Naive's loadingKeys mid-load
 * and can strand expand animation state.
 */
function clearCachedChildren(relativeDir: string): void {
  const node = findTreeNode(treeData.value, relativeDir);
  if (!node || node.isLeaf !== false) return;
  if (node.children === undefined) return;
  node.children = undefined;
}

/** Expand exactly the ancestor chain of `dir` (accordion). */
function ensureExpanded(dir: string): void {
  if (!dir) return;
  const chain = ancestorChain(dir);
  const prev = expandedKeys.value;
  expandedKeys.value = chain;
  // Clear dropped caches after keys update so Naive never animates a child-less collapse.
  const dropped = prev.filter((k) => !chain.includes(k));
  void nextTick(() => {
    for (const d of dropped) clearCachedChildren(d);
  });
}

/** Accordion: only one subdirectory branch open at a time. */
function onUpdateExpanded(keys: Array<string | number>): void {
  const prev = expandedKeys.value;
  const finalKeys = nextExpandedKeys(prev, keys.map(String));
  expandedKeys.value = finalKeys;
  // Defer cache drop: clearing children in the same turn as collapse makes Naive Tree
  // start expand animation with aipRef=true but no MotionWrapper → clicks stop working.
  const dropped = prev.filter((k) => !finalKeys.includes(k));
  if (!dropped.length) return;
  void nextTick(() => {
    for (const dir of dropped) clearCachedChildren(dir);
  });
}

function openFile(filePath: string): void {
  previewStore.openPreview(filePath);
  rightTabs.addTab("preview", {
    filePath,
    label: filePath.split(/[/\\]/).pop() ?? t.preview,
  });
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
}

function onSelect(keys: Array<string | number>, option: Array<TreeOption | null>): void {
  selectedKeys.value = keys.map(String);
  const node = option[0];
  if (!node || node.isLeaf === false) return;
  openFile(String(node.key));
}

function closeCtx(): void {
  ctx.value.show = false;
}

function openCtx(e: MouseEvent, path: string, kind: "file" | "dir" | "blank"): void {
  e.preventDefault();
  e.stopPropagation();
  ctx.value = { show: true, x: e.clientX, y: e.clientY, path, kind };
}

function nodeProps({ option }: { option: TreeOption }) {
  const path = String(option.key);
  const isDir = option.isLeaf === false;
  return {
    "data-path": path,
    "data-kind": isDir ? "dir" : "file",
    // Do NOT set draggable/onDrag* here — Naive TreeNodeContent overwrites them.
    // Use NTree `draggable` + @drop instead.
    class: cutPath.value === path ? "is-cut" : undefined,
    onContextmenu(e: MouseEvent) {
      openCtx(e, path, isDir ? "dir" : "file");
    },
  };
}

const ctxOptions = computed<DropdownOption[]>(() => {
  const kind = ctx.value.kind;
  const items: DropdownOption[] = [];
  const pasteDest =
    kind === "dir" ? ctx.value.path : kind === "file" ? parentDirOf(ctx.value.path) : "";
  const canPaste = Boolean(cutPath.value) && canMoveInto(cutPath.value!, pasteDest);

  if (kind === "file") {
    items.push(
      { label: t.open, key: "open" },
      { label: t.filesAddToChat, key: "cite", icon: () => h(NIcon, null, { default: () => h(ChatbubbleEllipsesOutline) }) },
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
      { label: t.filesAddToChat, key: "cite", icon: () => h(NIcon, null, { default: () => h(ChatbubbleEllipsesOutline) }) },
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
});

function openPrompt(mode: "file" | "dir" | "rename", targetDir: string, renamePath = ""): void {
  promptMode.value = mode;
  promptTargetDir.value = targetDir;
  promptRenamePath.value = renamePath;
  if (mode === "file") {
    promptTitle.value = t.filesNewFile;
    promptValue.value = "untitled.txt";
  } else if (mode === "dir") {
    promptTitle.value = t.filesNewFolder;
    promptValue.value = "new-folder";
  } else {
    promptTitle.value = t.filesRename;
    promptValue.value = renamePath.split("/").pop() ?? "";
  }
  promptOpen.value = true;
}

async function refreshNode(relativeDir: string): Promise<void> {
  if (!relativeDir) {
    const fresh = await loadChildren("");
    const prevByKey = new Map(treeData.value.map((n) => [String(n.key), n] as const));
    for (const opt of fresh) {
      if (opt.isLeaf === false && expandedKeys.value.includes(String(opt.key))) {
        const prev = prevByKey.get(String(opt.key));
        if (prev?.children) opt.children = prev.children;
      }
    }
    treeData.value = fresh;
    return;
  }
  await reloadNodeChildren(relativeDir);
}

function toAbsolutePath(relativePath: string): string {
  const root = (workspace.root || "").replace(/[\\/]+$/, "");
  if (!relativePath) return root;
  const sep = root.includes("\\") ? "\\" : "/";
  const rel = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${root}${sep}${rel.split("/").join(sep)}`;
}

async function onCtxSelect(key: string | number): Promise<void> {
  closeCtx();
  const action = String(key);
  const target = ctx.value.path;
  const kind = ctx.value.kind;
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
        cutPath.value = target;
        message.success(t.filesCutReady);
        break;
      case "paste": {
        const src = cutPath.value;
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
        const d = dialog.warning({
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
                selectedKeys.value = selectedKeys.value.filter((k) => k !== target);
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
  const name = promptValue.value.trim();
  if (!name) {
    message.warning(t.filesNameRequired);
    return false;
  }
  try {
    if (promptMode.value === "file") {
      const created = await window.api.files.createFile(promptTargetDir.value, name);
      if (promptTargetDir.value) ensureExpanded(promptTargetDir.value);
      await refreshNode(promptTargetDir.value);
      openFile(created);
    } else if (promptMode.value === "dir") {
      await window.api.files.createDir(promptTargetDir.value, name);
      if (promptTargetDir.value) ensureExpanded(promptTargetDir.value);
      await refreshNode(promptTargetDir.value);
    } else {
      const next = await window.api.files.rename(promptRenamePath.value, name);
      await refreshNode(parentDirOf(promptRenamePath.value));
      selectedKeys.value = [next];
    }
    promptOpen.value = false;
    await refreshGit();
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function toolbarNewFile(): void {
  const sel = selectedKeys.value[0];
  let dir = "";
  if (sel) {
    const node = findTreeNode(treeData.value, sel);
    dir = node?.isLeaf === false ? sel : parentDirOf(sel);
  }
  openPrompt("file", dir);
}

function toolbarNewDir(): void {
  const sel = selectedKeys.value[0];
  let dir = "";
  if (sel) {
    const node = findTreeNode(treeData.value, sel);
    dir = node?.isLeaf === false ? sel : parentDirOf(sel);
  }
  openPrompt("dir", dir);
}

onMounted(() => {
  void refreshRoot();
  offFs = window.api.fs.onChanged((payload) => {
    // Ignore events from a previous workspace (stale watch race)
    if (!workspace.root || !sameWorkspaceRoot(payload.root, workspace.root)) return;
    scheduleFsRefresh(payload.events ?? []);
    window.dispatchEvent(new CustomEvent("pi-fs-changed", { detail: payload }));
  });
});

onUnmounted(() => {
  offFs?.();
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  clearDragState();
  // Do NOT unwatch here — watcher is owned by workspace switch lifecycle in main/store
});

watch(
  () => workspace.root,
  () => {
    expandedKeys.value = [];
    selectedKeys.value = [];
    cutPath.value = null;
    clearDragState();
    void refreshRoot();
  },
);

watch(
  () => ctx.value.show,
  (show) => {
    if (show) {
      void nextTick(() => {
        // keep focus for dropdown
      });
    }
  },
);
</script>

<template>
  <div class="files-tab">
    <div class="head">
      <NText class="title" :title="workspace.root ?? undefined">
        {{ t.filesTab }}
      </NText>
      <NSpace :size="2">
        <NButton quaternary circle size="tiny" :title="t.filesRefresh" @click="refreshRoot">
          <template #icon>
            <NIcon :component="RefreshOutline" :size="14" />
          </template>
        </NButton>
        <NButton quaternary circle size="tiny" :title="t.filesNewFile" @click="toolbarNewFile">
          <template #icon>
            <NIcon :component="DocumentAttachOutline" :size="14" />
          </template>
        </NButton>
        <NButton quaternary circle size="tiny" :title="t.filesNewFolder" @click="toolbarNewDir">
          <template #icon>
            <NIcon :component="FolderOpenOutline" :size="14" />
          </template>
        </NButton>
      </NSpace>
    </div>

    <div
      class="body"
      :class="{ 'drop-root': dropTargetPath === '' }"
      @contextmenu="(e) => openCtx(e, '', 'blank')"
      @dragover="onRootDragOver"
      @dragleave="onRootDragLeave"
      @drop="onRootDrop"
    >
      <NEmpty v-if="!workspace.root" :description="t.filesOpenWorkspaceFirst" size="small" />
      <NSpin v-else :show="loading" size="small">
        <NTree
          v-if="treeData.length"
          block-line
          expand-on-click
          :animated="false"
          draggable
          :allow-drop="allowTreeDrop"
          :data="treeData"
          :expanded-keys="expandedKeys"
          :selected-keys="selectedKeys"
          :on-load="onLoad"
          :render-prefix="renderPrefix"
          :render-suffix="renderSuffix"
          :render-label="renderLabel"
          :node-props="nodeProps"
          @dragstart="onTreeDragStart"
          @dragend="onTreeDragEnd"
          @drop="onTreeDrop"
          @update:expanded-keys="onUpdateExpanded"
          @update:selected-keys="onSelect"
        />
        <NEmpty v-else-if="!loading" :description="t.filesEmptyDir" size="small" />
      </NSpin>
    </div>

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctx.x"
      :y="ctx.y"
      :show="ctx.show"
      :options="ctxOptions"
      @clickoutside="closeCtx"
      @select="onCtxSelect"
    />

    <NModal
      v-model:show="promptOpen"
      preset="dialog"
      :title="promptTitle"
      :positive-text="t.confirm"
      :negative-text="t.cancel"
      @positive-click="submitPrompt"
    >
      <NInput
        v-model:value="promptValue"
        size="small"
        autofocus
        @keydown.enter.prevent="submitPrompt"
      />
    </NModal>
  </div>
</template>

<style scoped>
.files-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-height: 28px;
}

.title {
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 2px 4px;
}

.body.drop-root {
  outline: 1px dashed var(--accent-border, #93c5fd);
  outline-offset: -2px;
  background: var(--accent-soft, rgba(37, 99, 235, 0.08));
}

.body :deep(.n-tree .n-tree-node-content) {
  font-size: 12px;
  min-height: 22px;
  border-radius: 6px;
  transition: background 120ms ease;
}

.body :deep(.n-tree .n-tree-node-content.drop-target) {
  background: var(--accent-soft, rgba(37, 99, 235, 0.12));
  box-shadow: inset 0 0 0 1px var(--accent-border, #93c5fd);
}

.body :deep(.n-tree .n-tree-node-content.drag-source),
.body :deep(.n-tree .n-tree-node-content.is-cut) {
  opacity: 0.45;
}

.body :deep(.n-tree-node-wrapper) {
  padding: 0;
}

.tree-label {
  font-size: 12px;
}

:deep(.git-badge) {
  font-size: 10px;
  font-weight: 700;
  font-family: var(--font-mono);
  margin-left: 4px;
  opacity: 0.95;
}

:deep(.git-dot) {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ca8a04;
  display: inline-block;
  margin-left: 6px;
}
</style>
