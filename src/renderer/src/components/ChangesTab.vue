<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import type { DropdownOption } from "naive-ui";
import {
  NButton,
  NCheckbox,
  NDropdown,
  NEmpty,
  NIcon,
  NInput,
  NSpin,
  NText,
  useMessage,
} from "naive-ui";
import {
  ArrowDownOutline,
  ArrowUpOutline,
  GitBranchOutline,
  GitCommitOutline,
  GitCompareOutline,
  GitMergeOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import { t } from "@renderer/i18n";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { countDiffStats } from "@renderer/utils/tool-diff";
import ChangesDiffEditor from "@renderer/components/ChangesDiffEditor.vue";

type GitFile = { relativePath: string; status: string; code: string };

const workspace = useWorkspaceStore();
const message = useMessage();

const loading = ref(false);
const busy = ref(false);
const isGit = ref(false);
const branch = ref<string | null>(null);
const files = ref<GitFile[]>([]);
const checked = ref<Record<string, boolean>>({});
const selectedPath = ref<string | null>(null);
const patch = ref<string | null>(null);
const oldContent = ref("");
const newContent = ref("");
const diffSupported = ref(true);
const commitMessage = ref("");
const localBranches = ref<string[]>([]);

const checkedPaths = computed(() =>
  files.value.filter((f) => checked.value[f.relativePath]).map((f) => f.relativePath),
);

const allChecked = computed(
  () => files.value.length > 0 && files.value.every((f) => checked.value[f.relativePath]),
);

const someChecked = computed(
  () => files.value.some((f) => checked.value[f.relativePath]) && !allChecked.value,
);

const canCommit = computed(
  () => Boolean(commitMessage.value.trim()) && checkedPaths.value.length > 0 && !busy.value,
);

const selectedFileName = computed(() => {
  if (!selectedPath.value) return "";
  return selectedPath.value.split(/[/\\]/).pop() || selectedPath.value;
});

const diffStats = computed(() => {
  if (!patch.value) return null;
  return countDiffStats(patch.value);
});

const showDiffEditor = computed(
  () => Boolean(selectedPath.value && diffSupported.value && patch.value != null),
);

const branchMenu = computed<DropdownOption[]>(() => {
  const items: DropdownOption[] = localBranches.value.map((name) => ({
    label: name === branch.value ? `${name} ?` : name,
    key: `checkout:${name}`,
    disabled: name === branch.value,
  }));
  items.push({ type: "divider", key: "d1" });
  items.push({
    label: t.changesNewBranch,
    key: "new",
    icon: () => h(NIcon, null, { default: () => h(GitBranchOutline) }),
  });
  items.push({
    label: t.changesMergeBranch,
    key: "merge",
    icon: () => h(NIcon, null, { default: () => h(GitMergeOutline) }),
  });
  return items;
});

function syncChecks(next: GitFile[]): void {
  const prev = checked.value;
  const map: Record<string, boolean> = {};
  for (const f of next) {
    map[f.relativePath] = prev[f.relativePath] ?? true;
  }
  checked.value = map;
  if (selectedPath.value && !map[selectedPath.value]) {
    selectedPath.value = next[0]?.relativePath ?? null;
  } else if (!selectedPath.value && next[0]) {
    selectedPath.value = next[0].relativePath;
  }
}

function setAllChecked(value: boolean): void {
  const map: Record<string, boolean> = {};
  for (const f of files.value) {
    map[f.relativePath] = value;
  }
  checked.value = map;
}

function onToggleAll(value: boolean): void {
  setAllChecked(value);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const status = await window.api.git.status();
    isGit.value = status.isGitRepository;
    branch.value = status.branch;
    files.value = status.files as GitFile[];
    syncChecks(files.value);
    if (status.isGitRepository) {
      const br = await window.api.git.branches();
      localBranches.value = br.local;
      if (br.current) branch.value = br.current;
    } else {
      localBranches.value = [];
      selectedPath.value = null;
      patch.value = null;
      oldContent.value = "";
      newContent.value = "";
    }
    if (selectedPath.value) await loadDiff(selectedPath.value);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    loading.value = false;
  }
}

async function loadDiff(relativePath: string): Promise<void> {
  selectedPath.value = relativePath;
  const result = await window.api.git.diff(relativePath);
  diffSupported.value = result.supported;
  if (!result.supported) {
    patch.value = null;
    oldContent.value = "";
    newContent.value = "";
    return;
  }
  patch.value = result.patch ?? null;
  oldContent.value = result.oldContent ?? "";
  newContent.value = result.newContent ?? "";
}

async function runOp(
  labelOk: string,
  fn: () => Promise<{ ok: true; message?: string } | { ok: false; message: string }>,
): Promise<void> {
  busy.value = true;
  try {
    const result = await fn();
    if (!result.ok) {
      message.error(result.message);
      return;
    }
    message.success(labelOk);
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function onCommit(): Promise<void> {
  if (!canCommit.value) return;
  const msg = commitMessage.value.trim();
  const paths = [...checkedPaths.value];
  busy.value = true;
  try {
    const result = await window.api.git.commit({ message: msg, paths });
    if (!result.ok) {
      message.error(result.message);
      return;
    }
    message.success(t.changesCommitted);
    commitMessage.value = "";
    await refresh();
  } finally {
    busy.value = false;
  }
}

async function onPull(): Promise<void> {
  await runOp(t.changesPulled, () => window.api.git.pull());
}

async function onPush(): Promise<void> {
  await runOp(t.changesPushed, () => window.api.git.push());
}

function onBranchSelect(key: string | number): void {
  const k = String(key);
  if (k === "new") {
    const name = window.prompt(t.changesNewBranchPrompt, "");
    if (!name?.trim()) return;
    void runOp(t.changesBranchCreated, () => window.api.git.createBranch(name.trim()));
    return;
  }
  if (k === "merge") {
    const name = window.prompt(t.changesMergePrompt, "");
    if (!name?.trim()) return;
    void runOp(t.changesMerged, () => window.api.git.merge(name.trim()));
    return;
  }
  if (k.startsWith("checkout:")) {
    const name = k.slice("checkout:".length);
    void runOp(t.changesCheckoutOk, () => window.api.git.checkout(name));
  }
}

function onFsChanged(): void {
  if (!workspace.root) return;
  void refresh();
}

onMounted(() => {
  void refresh();
  window.addEventListener("pi-fs-changed", onFsChanged);
});

onUnmounted(() => {
  window.removeEventListener("pi-fs-changed", onFsChanged);
});

watch(
  () => workspace.root,
  () => {
    void refresh();
  },
);
</script>

<template>
  <div class="changes-tab">
    <div class="toolbar">
      <NDropdown trigger="click" :options="branchMenu" :disabled="!isGit || busy" @select="onBranchSelect">
        <NButton size="tiny" quaternary :disabled="!isGit || busy">
          <template #icon>
            <NIcon :component="GitBranchOutline" :size="14" />
          </template>
          {{ branch || t.changesBranch }}
        </NButton>
      </NDropdown>
      <div class="spacer" />
      <NButton class="tool-btn" size="tiny" quaternary :disabled="!isGit || busy" :title="t.changesPull" @click="onPull">
        <template #icon>
          <NIcon :component="ArrowDownOutline" :size="14" />
        </template>
        {{ t.changesPull }}
      </NButton>
      <NButton class="tool-btn" size="tiny" quaternary :disabled="!isGit || busy" :title="t.changesPush" @click="onPush">
        <template #icon>
          <NIcon :component="ArrowUpOutline" :size="14" />
        </template>
        {{ t.changesPush }}
      </NButton>
      <NButton size="tiny" quaternary circle :disabled="busy" :title="t.changesRefresh" @click="refresh">
        <template #icon>
          <NIcon :component="RefreshOutline" :size="14" />
        </template>
      </NButton>
    </div>

    <div v-if="isGit" class="commit-row">
      <NInput
        v-model:value="commitMessage"
        size="tiny"
        :placeholder="t.changesCommitPlaceholder"
        :disabled="busy"
        @keydown.enter.exact.prevent="onCommit"
      />
      <NButton class="tool-btn" size="tiny" type="primary" :disabled="!canCommit" :loading="busy" @click="onCommit">
        <template #icon>
          <NIcon :component="GitCommitOutline" :size="14" />
        </template>
        {{ t.changesCommit }}
      </NButton>
    </div>

    <NSpin :show="loading" class="body">
      <template v-if="!isGit">
        <div class="empty-wrap">
          <NEmpty :description="t.changesNotGit" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
          </NEmpty>
        </div>
      </template>
      <template v-else-if="!files.length">
        <div class="empty-wrap">
          <NEmpty :description="t.changesEmpty" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
          </NEmpty>
        </div>
      </template>
      <div v-else class="split">
        <div class="file-list">
          <div class="list-head">
            <NCheckbox
              :checked="allChecked"
              :indeterminate="someChecked"
              size="small"
              :title="allChecked ? t.changesSelectNone : t.changesSelectAll"
              @update:checked="onToggleAll"
            />
            <NText depth="3" style="font-size: 11px">
              {{ t.changesFiles }} ({{ checkedPaths.length }}/{{ files.length }})
            </NText>
            <button
              type="button"
              class="select-all-link"
              @click="onToggleAll(!allChecked)"
            >
              {{ allChecked ? t.changesSelectNone : t.changesSelectAll }}
            </button>
          </div>
          <button
            v-for="f in files"
            :key="f.relativePath"
            type="button"
            class="file-row"
            :class="{ active: selectedPath === f.relativePath }"
            @click="loadDiff(f.relativePath)"
          >
            <NCheckbox
              :checked="checked[f.relativePath]"
              size="small"
              @click.stop
              @update:checked="(v) => (checked[f.relativePath] = v)"
            />
            <span class="code" :data-code="f.code">{{ f.code }}</span>
            <span class="path" :title="f.relativePath">{{ f.relativePath }}</span>
          </button>
        </div>
        <div class="diff-pane">
          <NText v-if="!selectedPath" depth="3" style="font-size: 12px; padding: 12px">
            {{ t.changesSelectFile }}
          </NText>
          <NText v-else-if="!diffSupported || !patch" depth="3" style="font-size: 12px; padding: 12px">
            {{ t.changesNoDiff }}
          </NText>
          <template v-else>
            <header class="diff-head">
              <div class="diff-titles">
                <div class="diff-name" :title="selectedPath">{{ selectedFileName }}</div>
              </div>
              <div v-if="diffStats" class="diff-stats" :title="selectedPath ?? undefined">
                <span class="add">+{{ diffStats.additions }}</span>
                <span class="del">-{{ diffStats.deletions }}</span>
              </div>
            </header>
            <div class="diff-editor-wrap">
              <ChangesDiffEditor
                v-if="showDiffEditor && selectedPath"
                :file-path="selectedPath"
                :old-content="oldContent"
                :new-content="newContent"
              />
            </div>
          </template>
        </div>
      </div>
    </NSpin>
  </div>
</template>

<style scoped>
.changes-tab {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.tool-btn {
  font-size: 12px;
  gap: 4px;
}

.spacer {
  flex: 1;
}

.commit-row {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-height: 0;
}

.body :deep(.n-spin-content) {
  height: 100%;
}

.empty-wrap {
  height: 100%;
  display: grid;
  place-items: center;
}

.split {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(160px, 38%) 1fr;
  min-height: 0;
}

.file-list {
  border-right: 1px solid var(--border);
  overflow: auto;
  min-height: 0;
}

.list-head {
  padding: 6px 8px;
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}

.select-all-link {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}

.select-all-link:hover {
  text-decoration: underline;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--fg);
}

.file-row:hover {
  background: var(--bg-hover);
}

.file-row.active {
  background: var(--bg-panel);
}

.code {
  font-family: var(--font-mono), monospace;
  font-size: 11px;
  font-weight: 600;
  width: 12px;
  flex-shrink: 0;
}

.code[data-code="M"] {
  color: #c27803;
}
.code[data-code="A"],
.code[data-code="U"] {
  color: #3f8f5a;
}
.code[data-code="D"] {
  color: #c44;
}
.code[data-code="C"] {
  color: #c44;
}
.code[data-code="R"] {
  color: #3b82f6;
}

.path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.diff-pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  background: var(--bg-panel);
}

.diff-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg);
}

.diff-titles {
  flex: 1;
  min-width: 0;
}

.diff-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-path {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono), monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-stats {
  flex-shrink: 0;
  display: inline-flex;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-mono), monospace;
  font-variant-numeric: tabular-nums;
  padding-top: 2px;
}

.diff-stats .add {
  color: #1a7f37;
}

.diff-stats .del {
  color: #cf222e;
}

.diff-editor-wrap {
  flex: 1;
  min-height: 0;
}
</style>
