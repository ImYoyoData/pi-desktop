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
  NModal,
  NSpin,
  NText,
  useMessage,
} from "naive-ui";
import {
  ArrowDownOutline,
  ArrowUndoOutline,
  ArrowUpOutline,
  CloudDownloadOutline,
  CloudOutline,
  GitBranchOutline,
  GitCommitOutline,
  GitCompareOutline,
  GitMergeOutline,
  RefreshOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import { t } from "@renderer/i18n";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { countDiffStats } from "@renderer/utils/tool-diff";
import ChangesDiffEditor from "@renderer/components/ChangesDiffEditor.vue";
import ChangesConflictResolve from "@renderer/components/ChangesConflictResolve.vue";
import type { GitErrorCode } from "../../../shared/git-types";

type GitFile = { relativePath: string; status: string; code: string };
type GitRemote = { name: string; fetchUrl: string; pushUrl: string };
type GitLogEntry = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};
type GitOp =
  | { ok: true; message?: string }
  | { ok: false; message: string; code?: string };

const workspace = useWorkspaceStore();
const message = useMessage();

const loading = ref(false);
const busy = ref(false);
const isGit = ref(false);
const gitUnavailable = ref(false);
const branch = ref<string | null>(null);
const files = ref<GitFile[]>([]);
const checked = ref<Record<string, boolean>>({});
const selectedPath = ref<string | null>(null);
const patch = ref<string | null>(null);
const conflictPayload = ref<null | {
  working: string;
  labels: { ours: string; theirs: string };
}>(null);
const oldContent = ref("");
const newContent = ref("");
const diffSupported = ref(true);
const commitMessage = ref("");
const localBranches = ref<string[]>([]);
const remoteBranches = ref<string[]>([]);
const remotes = ref<GitRemote[]>([]);
const showRemotes = ref(false);
const showLog = ref(false);
const remoteName = ref("origin");
const remoteUrl = ref("");
const logEntries = ref<GitLogEntry[]>([]);
const logLoading = ref(false);

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

const canDiscardSelected = computed(
  () => checkedPaths.value.length > 0 && !busy.value && isGit.value,
);

const conflictCount = computed(
  () => files.value.filter((f) => f.status === "conflict" || f.code === "C").length,
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
  const items: DropdownOption[] = [];
  if (localBranches.value.length) {
    items.push({
      type: "group",
      key: "local-group",
      label: t.changesLocalBranches,
      children: localBranches.value.map((name) => ({
        label: name === branch.value ? `${name} ✓` : name,
        key: `checkout:${name}`,
        disabled: name === branch.value,
      })),
    });
  }
  if (remoteBranches.value.length) {
    items.push({
      type: "group",
      key: "remote-group",
      label: t.changesRemoteBranches,
      children: remoteBranches.value.map((name) => ({
        label: name,
        key: `checkout:${name}`,
      })),
    });
  }
  if (items.length) items.push({ type: "divider", key: "d1" });
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

function formatGitError(result: Extract<GitOp, { ok: false }>): string {
  const code = (result.code || "unknown") as GitErrorCode;
  const key = `gitErr_${code}` as keyof typeof t;
  const localized = typeof t[key] === "string" ? (t[key] as string) : t.gitErr_unknown;
  const detail = result.message?.trim();
  if (!detail || detail === code || detail === localized) return localized;
  if (code === "unknown" || code === "invalid_args") return `${localized}\n${detail}`;
  return localized;
}

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

async function refreshRemotes(): Promise<void> {
  if (!isGit.value) {
    remotes.value = [];
    return;
  }
  try {
    remotes.value = await window.api.git.remotes();
  } catch {
    remotes.value = [];
  }
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const status = await window.api.git.status();
    isGit.value = status.isGitRepository;
    gitUnavailable.value = status.errorCode === "git_unavailable";
    branch.value = status.branch;
    files.value = status.files as GitFile[];
    syncChecks(files.value);
    if (status.errorCode === "git_unavailable") {
      message.error(
        formatGitError({
          ok: false,
          code: "git_unavailable",
          message: status.errorMessage || "",
        }),
      );
    }
    if (status.isGitRepository && !gitUnavailable.value) {
      const br = await window.api.git.branches();
      localBranches.value = br.local;
      remoteBranches.value = br.remote ?? [];
      if (br.current) branch.value = br.current;
      await refreshRemotes();
    } else {
      localBranches.value = [];
      remoteBranches.value = [];
      remotes.value = [];
      selectedPath.value = null;
      patch.value = null;
      conflictPayload.value = null;
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
  const file = files.value.find((f) => f.relativePath === relativePath);
  if (file && (file.status === "conflict" || file.code === "C")) {
    const result = await window.api.git.conflictContent(relativePath);
    if (result.supported) {
      conflictPayload.value = { working: result.working, labels: result.labels };
      patch.value = null;
      return;
    }
    conflictPayload.value = null;
  } else {
    conflictPayload.value = null;
  }
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

async function runOp(labelOk: string, fn: () => Promise<GitOp>): Promise<boolean> {
  busy.value = true;
  try {
    const result = await fn();
    if (!result.ok) {
      message.error(formatGitError(result));
      if (result.code === "no_remote") showRemotes.value = true;
      await refresh();
      return false;
    }
    message.success(labelOk);
    await refresh();
    return true;
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
      message.error(formatGitError(result));
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

async function onFetch(): Promise<void> {
  await runOp(t.changesFetched, () => window.api.git.fetch());
}

async function onDiscardSelected(): Promise<void> {
  const paths = [...checkedPaths.value];
  if (!paths.length) return;
  if (!window.confirm(t.changesDiscardConfirmSelected)) return;
  await runOp(t.changesDiscarded, () => window.api.git.restore(paths));
}

async function onDiscardFile(relativePath: string): Promise<void> {
  if (!relativePath) return;
  if (!window.confirm(t.changesDiscardConfirmFile)) return;
  await runOp(t.changesDiscarded, () => window.api.git.restore([relativePath]));
}

async function onConflictResolve(content: string): Promise<void> {
  if (!selectedPath.value) return;
  await runOp(t.changesConflictResolved, () =>
    window.api.git.resolveConflict({ relativePath: selectedPath.value!, content }),
  );
}

async function onConflictAcceptSide(side: "ours" | "theirs"): Promise<void> {
  if (!selectedPath.value) return;
  await runOp(t.changesConflictResolved, () =>
    window.api.git.checkoutConflictSide({ relativePath: selectedPath.value!, side }),
  );
}

async function onAbortMerge(): Promise<void> {
  if (!window.confirm(t.changesConflictAbort + "?")) return;
  await runOp(t.changesConflictAborted, () => window.api.git.abortMerge());
}

async function onInitGit(): Promise<void> {
  await runOp(t.changesGitInitialized, () => window.api.git.init());
}

async function openRemotes(): Promise<void> {
  showRemotes.value = true;
  await refreshRemotes();
}

async function openLog(): Promise<void> {
  showLog.value = true;
  logLoading.value = true;
  try {
    const result = await window.api.git.log(80);
    logEntries.value = result.entries;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    logEntries.value = [];
  } finally {
    logLoading.value = false;
  }
}

async function onAddRemote(): Promise<void> {
  const name = remoteName.value.trim();
  const url = remoteUrl.value.trim();
  if (!name || !url) {
    message.error(t.gitErr_invalid_args);
    return;
  }
  const ok = await runOp(t.changesRemoteAdded, () =>
    window.api.git.addRemote({ name, url }),
  );
  if (ok) {
    remoteUrl.value = "";
    await refreshRemotes();
  }
}

async function onEditRemote(remote: GitRemote): Promise<void> {
  const next = window.prompt(t.changesRemoteEdit, remote.pushUrl || remote.fetchUrl);
  if (next == null) return;
  const url = next.trim();
  if (!url) return;
  await runOp(t.changesRemoteUpdated, () =>
    window.api.git.setRemoteUrl({ name: remote.name, url }),
  );
  await refreshRemotes();
}

async function onRemoveRemote(remote: GitRemote): Promise<void> {
  if (!window.confirm(`${t.changesRemoteRemove}: ${remote.name}?`)) return;
  await runOp(t.changesRemoteRemoved, () => window.api.git.removeRemote(remote.name));
  await refreshRemotes();
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

function formatLogDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
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
      <NButton
        class="tool-btn"
        size="tiny"
        quaternary
        :disabled="!isGit || busy"
        :title="t.changesRemotes"
        @click="openRemotes"
      >
        <template #icon>
          <NIcon :component="CloudOutline" :size="14" />
        </template>
        {{ t.changesRemotes }}
        <span v-if="remotes.length" class="remote-count">{{ remotes.length }}</span>
      </NButton>
      <NButton
        class="tool-btn"
        size="tiny"
        quaternary
        :disabled="!isGit || busy"
        :title="t.changesLog"
        @click="openLog"
      >
        <template #icon>
          <NIcon :component="TimeOutline" :size="14" />
        </template>
        {{ t.changesLog }}
      </NButton>
      <NButton
        class="tool-btn"
        size="tiny"
        quaternary
        :disabled="!isGit || busy"
        :title="t.changesFetch"
        @click="onFetch"
      >
        <template #icon>
          <NIcon :component="CloudDownloadOutline" :size="14" />
        </template>
        {{ t.changesFetch }}
      </NButton>
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

    <div v-if="isGit && conflictCount > 0" class="conflict-banner">
      <span>{{ t.changesConflictBanner }} ({{ conflictCount }})</span>
      <NButton size="tiny" quaternary :disabled="busy" @click="onAbortMerge">
        {{ t.changesConflictBannerAction }}
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
      <NButton
        class="tool-btn"
        size="tiny"
        quaternary
        :disabled="!canDiscardSelected"
        :title="t.changesDiscardSelected"
        @click="onDiscardSelected"
      >
        <template #icon>
          <NIcon :component="ArrowUndoOutline" :size="14" />
        </template>
        {{ t.changesDiscardSelected }}
      </NButton>
      <NButton class="tool-btn" size="tiny" type="primary" :disabled="!canCommit" :loading="busy" @click="onCommit">
        <template #icon>
          <NIcon :component="GitCommitOutline" :size="14" />
        </template>
        {{ t.changesCommit }}
      </NButton>
    </div>

    <NSpin :show="loading" class="body">
      <template v-if="gitUnavailable">
        <div class="empty-wrap">
          <NEmpty :description="t.gitErr_git_unavailable" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
            <template #extra>
              <NText depth="3" style="font-size: 12px">{{ t.changesGitUnavailableHint }}</NText>
            </template>
          </NEmpty>
        </div>
      </template>
      <template v-else-if="!isGit">
        <div class="empty-wrap">
          <NEmpty :description="t.changesNotGit" size="small">
            <template #icon>
              <NIcon :component="GitCompareOutline" :size="28" />
            </template>
            <template #extra>
              <NButton
                type="primary"
                size="small"
                :loading="busy"
                :disabled="!workspace.root"
                @click="onInitGit"
              >
                {{ t.changesInitGit }}
              </NButton>
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
            <button
              type="button"
              class="row-discard"
              :title="t.changesDiscardFile"
              :disabled="busy"
              @click.stop="onDiscardFile(f.relativePath)"
            >
              <NIcon :component="ArrowUndoOutline" :size="13" />
            </button>
          </button>
        </div>
        <div class="diff-pane">
          <template v-if="!selectedPath">
            <NText depth="3" style="font-size: 12px; padding: 12px">
              {{ t.changesSelectFile }}
            </NText>
          </template>
          <template v-else>
            <header class="diff-head">
              <div class="diff-titles">
                <div class="diff-name" :title="selectedPath">{{ selectedFileName }}</div>
              </div>
              <div v-if="diffStats" class="diff-stats" :title="selectedPath ?? undefined">
                <span class="add">+{{ diffStats.additions }}</span>
                <span class="del">-{{ diffStats.deletions }}</span>
              </div>
              <NButton
                size="tiny"
                quaternary
                :disabled="busy"
                :title="t.changesDiscardFile"
                @click="onDiscardFile(selectedPath)"
              >
                <template #icon>
                  <NIcon :component="ArrowUndoOutline" :size="14" />
                </template>
                {{ t.changesDiscard }}
              </NButton>
            </header>
            <ChangesConflictResolve
              v-if="conflictPayload && selectedPath"
              :file-path="selectedPath"
              :working="conflictPayload.working"
              :labels="conflictPayload.labels"
              @resolve="onConflictResolve"
              @accept-side="onConflictAcceptSide"
            />
            <template v-else>
              <NText v-if="!diffSupported || !patch" depth="3" style="font-size: 12px; padding: 12px">
                {{ t.changesNoDiff }}
              </NText>
              <div v-else class="diff-editor-wrap">
                <ChangesDiffEditor
                  v-if="showDiffEditor && selectedPath"
                  :file-path="selectedPath"
                  :old-content="oldContent"
                  :new-content="newContent"
                />
              </div>
            </template>
          </template>
        </div>
      </div>
    </NSpin>

    <NModal
      v-model:show="showRemotes"
      preset="card"
      :title="t.changesRemotes"
      style="width: min(520px, 92vw)"
      :mask-closable="true"
    >
      <div class="remote-form">
        <NInput v-model:value="remoteName" size="small" :placeholder="t.changesRemoteName" :disabled="busy" />
        <NInput v-model:value="remoteUrl" size="small" :placeholder="t.changesRemoteUrl" :disabled="busy" />
        <NButton type="primary" size="small" :disabled="busy || !remoteName.trim() || !remoteUrl.trim()" @click="onAddRemote">
          {{ t.changesRemoteSave }}
        </NButton>
      </div>
      <NEmpty v-if="!remotes.length" :description="t.changesRemoteEmpty" size="small" style="margin-top: 12px" />
      <ul v-else class="remote-list">
        <li v-for="r in remotes" :key="r.name" class="remote-item">
          <div class="remote-meta">
            <div class="remote-name">{{ r.name }}</div>
            <div class="remote-url" :title="r.fetchUrl || r.pushUrl">{{ r.fetchUrl || r.pushUrl }}</div>
          </div>
          <div class="remote-actions">
            <NButton size="tiny" quaternary :disabled="busy" @click="onEditRemote(r)">{{ t.changesRemoteEdit }}</NButton>
            <NButton size="tiny" quaternary type="error" :disabled="busy" @click="onRemoveRemote(r)">
              {{ t.changesRemoteRemove }}
            </NButton>
          </div>
        </li>
      </ul>
    </NModal>

    <NModal
      v-model:show="showLog"
      preset="card"
      :title="t.changesLog"
      style="width: min(640px, 94vw)"
      :mask-closable="true"
    >
      <NSpin :show="logLoading">
        <NEmpty v-if="!logEntries.length" :description="t.changesLogEmpty" size="small" />
        <ul v-else class="log-list">
          <li v-for="entry in logEntries" :key="entry.hash" class="log-item">
            <code class="log-hash">{{ entry.shortHash }}</code>
            <div class="log-body">
              <div class="log-subject">{{ entry.subject }}</div>
              <div class="log-meta">{{ entry.author }} · {{ formatLogDate(entry.date) }}</div>
            </div>
          </li>
        </ul>
      </NSpin>
    </NModal>
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

.remote-count {
  margin-left: 4px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.conflict-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: #8a1f1f;
  background: color-mix(in srgb, #cf222e 12%, var(--bg));
  border-bottom: 1px solid color-mix(in srgb, #cf222e 28%, var(--border));
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

.row-discard {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  opacity: 0;
  cursor: pointer;
  padding: 0;
}

.file-row:hover .row-discard,
.file-row.active .row-discard {
  opacity: 0.65;
}

.row-discard:hover:not(:disabled) {
  opacity: 1;
  background: var(--bg-hover);
  color: #c44;
}

.row-discard:disabled {
  cursor: not-allowed;
  opacity: 0.3;
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

.remote-form {
  display: grid;
  grid-template-columns: 120px 1fr auto;
  gap: 8px;
  align-items: center;
}

.remote-list,
.log-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  max-height: min(50vh, 420px);
  overflow: auto;
}

.remote-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.remote-meta {
  flex: 1;
  min-width: 0;
}

.remote-name {
  font-size: 13px;
  font-weight: 600;
}

.remote-url {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
  font-family: var(--font-mono), monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remote-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.log-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.log-hash {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--accent);
  padding-top: 2px;
}

.log-body {
  min-width: 0;
}

.log-subject {
  font-size: 13px;
  color: var(--fg-strong);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
}
</style>
