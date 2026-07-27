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
    // Rehydrate expanded directories so watch updates show under open folders
    for (const key of [...expandedKeys.value]) {
      await reloadNodeChildren(key);
    }
  } finally {
    loading.value = false;
  }
}

async function reloadNodeChildren(relativeDir: string): Promise<void> {
  const find = (nodes: TreeOption[]): TreeOption | null => {
    for (const n of nodes) {
      if (String(n.key) === relativeDir) return n;
      if (n.children) {
        const hit = find(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const node = find(treeData.value);
  if (!node || node.isLeaf !== false) return;
  node.children = await loadChildren(relativeDir);
  treeData.value = [...treeData.value];
}

/** Debounced tree refresh from filesystem watcher. */
let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFsRefresh(): void {
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  fsRefreshTimer = setTimeout(() => {
    fsRefreshTimer = null;
    void refreshRoot();
  }, 250);
}

async function onLoad(option: TreeOption): Promise<void> {
  const key = String(option.key);
  option.children = await loadChildren(key);
}

function onUpdateExpanded(keys: Array<string | number>): void {
  expandedKeys.value = keys.map(String);
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

function parentDirOf(relPath: string): string {
  const normalized = relPath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx < 0 ? "" : normalized.slice(0, idx);
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
  return {
    onContextmenu(e: MouseEvent) {
      const kind = option.isLeaf === false ? "dir" : "file";
      openCtx(e, String(option.key), kind);
    },
  };
}

const ctxOptions = computed<DropdownOption[]>(() => {
  const kind = ctx.value.kind;
  const items: DropdownOption[] = [];
  if (kind === "file") {
    items.push(
      { label: t.open, key: "open" },
      { label: t.filesAddToChat, key: "cite" },
      { label: t.filesReveal, key: "reveal" },
      { type: "divider", key: "d1" },
      { label: t.filesRename, key: "rename" },
      { label: t.filesDelete, key: "delete" },
    );
  } else if (kind === "dir") {
    items.push(
      { label: t.filesNewFile, key: "new-file" },
      { label: t.filesNewFolder, key: "new-dir" },
      { label: t.filesAddToChat, key: "cite" },
      { label: t.filesReveal, key: "reveal" },
      { type: "divider", key: "d1" },
      { label: t.filesRename, key: "rename" },
      { label: t.filesDelete, key: "delete" },
    );
  } else {
    items.push(
      { label: t.filesNewFile, key: "new-file" },
      { label: t.filesNewFolder, key: "new-dir" },
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
    await refreshRoot();
    return;
  }
  const find = (nodes: TreeOption[]): TreeOption | null => {
    for (const n of nodes) {
      if (String(n.key) === relativeDir) return n;
      if (n.children) {
        const hit = find(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const node = find(treeData.value);
  if (node) {
    node.children = await loadChildren(relativeDir);
    // force reactivity
    treeData.value = [...treeData.value];
  } else {
    await refreshRoot();
  }
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
      case "delete": {
        dialog.warning({
          title: t.filesDeleteConfirmTitle,
          content: t.filesDeleteConfirm(target),
          positiveText: t.delete,
          negativeText: t.cancel,
          onPositiveClick: async () => {
            try {
              await window.api.files.delete(target);
              message.success(t.filesDeleted);
              await refreshNode(parentDirOf(target));
              await refreshGit();
              selectedKeys.value = selectedKeys.value.filter((k) => k !== target);
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
            }
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
      await refreshNode(promptTargetDir.value);
      if (promptTargetDir.value && !expandedKeys.value.includes(promptTargetDir.value)) {
        expandedKeys.value = [...expandedKeys.value, promptTargetDir.value];
      }
      openFile(created);
    } else if (promptMode.value === "dir") {
      await window.api.files.createDir(promptTargetDir.value, name);
      await refreshNode(promptTargetDir.value);
      if (promptTargetDir.value && !expandedKeys.value.includes(promptTargetDir.value)) {
        expandedKeys.value = [...expandedKeys.value, promptTargetDir.value];
      }
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
    const find = (nodes: TreeOption[]): TreeOption | null => {
      for (const n of nodes) {
        if (String(n.key) === sel) return n;
        if (n.children) {
          const hit = find(n.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    const node = find(treeData.value);
    dir = node?.isLeaf === false ? sel : parentDirOf(sel);
  }
  openPrompt("file", dir);
}

function toolbarNewDir(): void {
  const sel = selectedKeys.value[0];
  let dir = "";
  if (sel) {
    const find = (nodes: TreeOption[]): TreeOption | null => {
      for (const n of nodes) {
        if (String(n.key) === sel) return n;
        if (n.children) {
          const hit = find(n.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    const node = find(treeData.value);
    dir = node?.isLeaf === false ? sel : parentDirOf(sel);
  }
  openPrompt("dir", dir);
}

onMounted(() => {
  void refreshRoot();
  offFs = window.api.fs.onChanged((payload) => {
    // Ignore events from a previous workspace (stale watch race)
    if (!workspace.root || !sameWorkspaceRoot(payload.root, workspace.root)) return;
    scheduleFsRefresh();
    window.dispatchEvent(new CustomEvent("pi-fs-changed", { detail: payload }));
  });
});

onUnmounted(() => {
  offFs?.();
  if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
  // Do NOT unwatch here — watcher is owned by workspace switch lifecycle in main/store
});

watch(
  () => workspace.root,
  () => {
    expandedKeys.value = [];
    selectedKeys.value = [];
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

    <div class="body" @contextmenu="(e) => openCtx(e, '', 'blank')">
      <NEmpty v-if="!workspace.root" :description="t.filesOpenWorkspaceFirst" size="small" />
      <NSpin v-else :show="loading" size="small">
        <NTree
          v-if="treeData.length"
          block-line
          expand-on-click
          :data="treeData"
          :expanded-keys="expandedKeys"
          :selected-keys="selectedKeys"
          :on-load="onLoad"
          :render-prefix="renderPrefix"
          :render-suffix="renderSuffix"
          :render-label="renderLabel"
          :node-props="nodeProps"
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

.body :deep(.n-tree .n-tree-node-content) {
  font-size: 12px;
  min-height: 22px;
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
