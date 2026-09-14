<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NInput,
  NPopover,
  NScrollbar,
  useMessage,
} from "naive-ui";
import {
  CheckmarkOutline,
  ChevronDownOutline,
  FolderOpenOutline,
  GitBranchOutline,
} from "@vicons/ionicons5";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const sessions = useSessionsStore();
const workspace = useWorkspaceStore();
const message = useMessage();

const workspacePanelOpen = ref(false);
const branchPanelOpen = ref(false);
const isRepo = ref(false);
const currentBranch = ref<string | null>(null);
const localBranches = ref<string[]>([]);
const remoteBranches = ref<string[]>([]);
const newBranchName = ref("");
const busy = ref(false);

function baseName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() ?? path;
}

function samePath(a: string, b: string): boolean {
  return (
    a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase()
  );
}

const workspaceLabel = computed(() =>
  workspace.root ? baseName(workspace.root) : t.noFolder,
);

/** 当前工作区置顶，其后是最近工作区（去重）。 */
const workspaceList = computed(() => {
  const list: string[] = [];
  if (workspace.root) list.push(workspace.root);
  for (const path of workspace.recent) {
    if (workspace.root && samePath(path, workspace.root)) continue;
    list.push(path);
  }
  return list;
});

/** 切换草稿归属的工作区；先落草稿再切，避免 root watcher 放弃草稿。 */
async function moveDraft(root: string): Promise<void> {
  if (!root || (workspace.root && samePath(root, workspace.root))) return;
  const previous = sessions.draftRoot;
  sessions.setDraftRoot(root);
  const opened = await workspace.openWorkspacePath(root);
  if (opened && samePath(opened, root)) {
    sessions.setDraftRoot(opened);
    return;
  }
  if (previous) sessions.setDraftRoot(previous);
}

async function onPickWorkspace(path: string): Promise<void> {
  if (busy.value) return;
  workspacePanelOpen.value = false;
  busy.value = true;
  try {
    await moveDraft(path);
  } finally {
    busy.value = false;
  }
}

async function onOpenFolder(): Promise<void> {
  const picked = await window.api.workspace.pick();
  if (picked) await onPickWorkspace(picked);
  else workspacePanelOpen.value = false;
}

async function refreshGit(): Promise<void> {
  if (!workspace.root) {
    isRepo.value = false;
    currentBranch.value = null;
    localBranches.value = [];
    remoteBranches.value = [];
    return;
  }
  try {
    const status = await window.api.git.status();
    isRepo.value = status.isGitRepository;
    currentBranch.value = status.branch;
    if (!status.isGitRepository) {
      localBranches.value = [];
      remoteBranches.value = [];
      branchPanelOpen.value = false;
      return;
    }
    const branches = await window.api.git.branches();
    currentBranch.value = branches.current ?? status.branch;
    localBranches.value = branches.local;
    remoteBranches.value = branches.remote;
  } catch {
    isRepo.value = false;
  }
}

function formatGitError(result: { code?: string }): string {
  const key = `gitErr_${result.code || "unknown"}` as keyof typeof t;
  const text = t[key];
  return typeof text === "string" ? text : t.gitErr_unknown;
}

async function onCheckout(branch: string): Promise<void> {
  if (busy.value || branch === currentBranch.value) return;
  busy.value = true;
  try {
    const result = await window.api.git.checkout(branch);
    if (!result.ok) {
      message.error(formatGitError(result));
      return;
    }
    message.success(t.branchSwitched);
    await refreshGit();
    branchPanelOpen.value = false;
  } finally {
    busy.value = false;
  }
}

async function onCreateBranch(): Promise<void> {
  const name = newBranchName.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  try {
    const result = await window.api.git.createBranch(name);
    if (!result.ok) {
      message.error(formatGitError(result));
      return;
    }
    newBranchName.value = "";
    message.success(t.branchCreated);
    await refreshGit();
    branchPanelOpen.value = false;
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refreshGit();
});

watch(
  () => workspace.root,
  () => {
    branchPanelOpen.value = false;
    newBranchName.value = "";
    void refreshGit();
  },
);

watch(workspacePanelOpen, (open) => {
  if (!open) return;
  void workspace.listRecent();
});

watch(branchPanelOpen, (open) => {
  if (open) void refreshGit();
});
</script>

<template>
  <div class="draft-context-bar">
    <NPopover
      v-model:show="workspacePanelOpen"
      trigger="click"
      placement="bottom-start"
      :disabled="busy"
      raw
    >
      <template #trigger>
        <button
          type="button"
          class="ctx-trigger"
          :title="t.draftWorkspace"
          :disabled="busy"
        >
          <NIcon :component="FolderOpenOutline" :size="13" />
          <span class="ctx-label">{{ workspaceLabel }}</span>
          <NIcon :component="ChevronDownOutline" :size="11" />
        </button>
      </template>
      <div class="ctx-panel">
        <NScrollbar class="ctx-scroll">
          <button
            v-for="path in workspaceList"
            :key="path"
            type="button"
            class="ctx-item"
            :class="{ current: workspace.root && samePath(path, workspace.root) }"
            :title="path"
            :disabled="busy"
            @click="void onPickWorkspace(path)"
          >
            <NIcon
              v-if="workspace.root && samePath(path, workspace.root)"
              :component="CheckmarkOutline"
              :size="12"
            />
            <span class="ctx-item-main">
              <span class="ctx-item-name">{{ baseName(path) }}</span>
              <span class="ctx-item-path">{{ path }}</span>
            </span>
          </button>
          <button type="button" class="ctx-item open" :disabled="busy" @click="void onOpenFolder()">
            <NIcon :component="FolderOpenOutline" :size="12" />
            <span class="ctx-item-main">
              <span class="ctx-item-name">{{ t.openFolder }}</span>
            </span>
          </button>
        </NScrollbar>
      </div>
    </NPopover>

    <NPopover
      v-if="isRepo"
      v-model:show="branchPanelOpen"
      trigger="click"
      placement="bottom-start"
      :disabled="busy"
      raw
    >
      <template #trigger>
        <button
          type="button"
          class="ctx-trigger"
          :title="t.changesSwitchBranch"
          :disabled="busy"
        >
          <NIcon :component="GitBranchOutline" :size="13" />
          <span class="ctx-label">{{ currentBranch || t.draftBranch }}</span>
          <NIcon :component="ChevronDownOutline" :size="11" />
        </button>
      </template>
      <div class="ctx-panel branch-panel">
        <NScrollbar class="ctx-scroll">
          <button
            v-for="name in localBranches"
            :key="`l:${name}`"
            type="button"
            class="ctx-item"
            :class="{ current: name === currentBranch }"
            :disabled="busy"
            @click="void onCheckout(name)"
          >
            <NIcon
              v-if="name === currentBranch"
              :component="CheckmarkOutline"
              :size="12"
            />
            <span class="ctx-item-main">
              <span class="ctx-item-name">{{ name }}</span>
            </span>
          </button>
          <button
            v-for="name in remoteBranches"
            :key="`r:${name}`"
            type="button"
            class="ctx-item remote"
            :disabled="busy"
            @click="void onCheckout(name)"
          >
            <span class="ctx-item-main">
              <span class="ctx-item-name">{{ name }}</span>
            </span>
          </button>
        </NScrollbar>
        <div class="branch-create">
          <NInput
            v-model:value="newBranchName"
            size="tiny"
            :placeholder="t.draftBranchName"
            :disabled="busy"
            @keydown.enter.prevent="void onCreateBranch()"
          />
          <NButton
            size="tiny"
            secondary
            :disabled="busy || !newBranchName.trim()"
            @click="void onCreateBranch()"
          >
            {{ t.draftNewBranch }}
          </NButton>
        </div>
      </div>
    </NPopover>
  </div>
</template>

<style scoped>
.draft-context-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 0 4px 2px;
  min-width: 0;
}

.ctx-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted, #888);
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
}

.ctx-trigger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--fg-muted, #888) 12%, transparent);
  color: var(--fg-strong, #222);
}

.ctx-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}

.ctx-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 170px;
}

.ctx-panel {
  width: 264px;
  max-width: 80vw;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 80%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-panel, var(--bg-elevated, #fff)) 96%, transparent);
  box-shadow: 0 10px 28px color-mix(in srgb, #000 16%, transparent);
  backdrop-filter: blur(10px);
}

.ctx-scroll {
  max-height: 260px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg, inherit);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.ctx-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--fg-muted, #888) 12%, transparent);
}

.ctx-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.ctx-item.current {
  color: var(--accent, #3b82f6);
  font-weight: 600;
}

.ctx-item.remote .ctx-item-name {
  color: var(--fg-muted, #888);
}

.ctx-item-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.ctx-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-item-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  color: var(--fg-muted, #999);
}

.ctx-item.open {
  color: var(--fg-muted, #888);
}

.branch-create {
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
