<script setup lang="ts">
/**
 * Right-pane dock "Changes" view — 1:1 port of the VS Code Agents window
 * Changes view pane (src/vs/sessions/contrib/changes/browser/changesView.ts).
 *
 * Header = Versions picker (current changeset label + compact chevron; the
 * dropdown groups repository changesets before checkpoints, checkmarks the
 * active one, shows the "Last Turn Changes" description line) plus the
 * right-aligned animated-style diff stats (+A −D, tooltip "{N files}, A
 * additions, D deletions", click = View All Changes). Rows are VS Code
 * changes-tree file items: file icon + name + muted relative-dir description
 * (strikethrough when deleted), +N −N counts that hide on hover when the
 * inline action bar has actions, a hover toolbar (Open File, Alt = Open
 * Changes; discard for the uncommitted changeset) and the rightmost A/M/D
 * decoration badge. Empty state is the uniform "Changes / No changed files"
 * welcome.
 *
 * Changesets (provider-published in VS Code, mapped to local data):
 *   uncommitted — git working tree (git.status + per-file patch counts)
 *   session     — this agent session's working set (useSessionFileChanges)
 *   turn        — last agent turn (collectTurnFileChanges)
 */
import { computed, h, onMounted, onUnmounted, ref, watch } from "vue";
import type { VNodeChild } from "vue";
import { NDropdown, NIcon, useDialog, useMessage } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import {
  ArrowUndoOutline,
  Checkmark,
  ChevronDownOutline,
  DocumentOutline,
  OpenOutline,
} from "@vicons/ionicons5";
import { useChatStore } from "@renderer/stores/chat";
import { useLayoutStore } from "@renderer/stores/layout";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useSessionFileChanges } from "@renderer/utils/use-session-file-changes";
import { collectTurnFileChanges } from "@renderer/utils/turn-file-changes";
import { toolCardFor } from "@renderer/utils/tool-diff";
import { t } from "@renderer/i18n";

const props = withDefaults(
  defineProps<{
    /** False while the dock shows the Files view — defer git refreshes. */
    visible?: boolean;
  }>(),
  { visible: true },
);

type ChangesetId = "uncommitted" | "session" | "turn";
type ChangeType = "added" | "modified" | "deleted";
type ChangesetCategory = "repository" | "checkpoints";

const CHANGESET_KEY = "pi-desktop:right-dock-changeset:v1";
const LEGACY_SCOPE_KEY = "pi-desktop:right-dock-changes-scope:v1";

const CHANGESET_META: Record<
  ChangesetId,
  { label: () => string; description?: () => string; category: ChangesetCategory }
> = {
  uncommitted: { label: () => t.changesetUncommitted, category: "repository" },
  session: { label: () => t.changesetSession, category: "checkpoints" },
  turn: {
    label: () => t.changesetTurn,
    description: () => t.changesetTurnDesc,
    category: "checkpoints",
  },
};

/** Repository changesets come first, separator between categories. */
const CHANGESET_ORDER: ChangesetId[] = ["uncommitted", "session", "turn"];

const workspace = useWorkspaceStore();
const layout = useLayoutStore();
const rightTabs = useRightTabsStore();
const previewStore = usePreviewStore();
const sessions = useSessionsStore();
const message = useMessage();
const dialog = useDialog();
const chat = useChatStore();
const { files: sessionFiles } = useSessionFileChanges();

const changeset = ref<ChangesetId>(readChangeset());

function readChangeset(): ChangesetId {
  try {
    const raw =
      localStorage.getItem(CHANGESET_KEY) ?? localStorage.getItem(LEGACY_SCOPE_KEY);
    if (raw === "uncommitted" || raw === "session" || raw === "turn") return raw;
    if (raw === "workspace") return "uncommitted";
  } catch {
    // ignore
  }
  return "uncommitted";
}

watch(changeset, (v) => {
  try {
    localStorage.setItem(CHANGESET_KEY, v);
  } catch {
    // ignore
  }
});

/* ---- Versions picker dropdown ---- */

const changesetOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = [];
  let lastCategory: ChangesetCategory | null = null;
  for (const id of CHANGESET_ORDER) {
    const category = CHANGESET_META[id].category;
    if (lastCategory && category !== lastCategory) {
      options.push({ type: "divider", key: `sep-${category}` });
    }
    lastCategory = category;
    options.push({
      key: id,
      label: "",
      disabled: id !== "uncommitted" && !sessions.activeId,
    });
  }
  return options;
});

function renderChangesetLabel(option: DropdownOption): VNodeChild {
  const id = option.key as ChangesetId;
  const meta = CHANGESET_META[id];
  const selected = changeset.value === id;
  return h("div", { class: "changes-dock-option" }, [
    h(
      "span",
      { class: "changes-dock-option-check" },
      selected ? h(NIcon, { component: Checkmark, size: 13 }) : null,
    ),
    h("div", { class: "changes-dock-option-text" }, [
      h("div", { class: "changes-dock-option-label" }, meta.label()),
      meta.description
        ? h("div", { class: "changes-dock-option-desc" }, meta.description())
        : null,
    ]),
  ]);
}

function onChangesetSelect(key: string | number): void {
  if (key === "uncommitted" || key === "session" || key === "turn") {
    changeset.value = key;
  }
}

const currentLabel = computed(() => CHANGESET_META[changeset.value].label());
const pickerTooltip = computed(() => `${t.changesVersions}: ${currentLabel.value}`);

/* ---- uncommitted changeset: git working tree ---- */

type GitRow = { relativePath: string; code: string; ignored?: boolean };

const gitLoading = ref(false);
const isGit = ref(false);
const gitFiles = ref<GitRow[]>([]);
/** path → git code, also decorating the session/turn rows. */
const gitCodeMap = computed(
  () => new Map(gitFiles.value.map((f) => [f.relativePath, f.code])),
);
/** path → line counts parsed from the per-file patch. */
const statsMap = ref(new Map<string, { additions: number; deletions: number }>());
let statsSeq = 0;

function countPatch(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

async function refreshStats(paths: string[]): Promise<void> {
  const seq = ++statsSeq;
  const next = new Map(statsMap.value);
  const queue = [...paths];
  const workers = Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const path = queue.shift()!;
      try {
        const res = await window.api.git.diff(path);
        if (seq !== statsSeq) return;
        if (res.supported && res.patch) next.set(path, countPatch(res.patch));
      } catch {
        // Binary / large file — the row simply keeps no counts.
      }
    }
  });
  await Promise.all(workers);
  if (seq === statsSeq) statsMap.value = next;
}

async function refreshGit(): Promise<void> {
  if (!workspace.root) {
    gitFiles.value = [];
    isGit.value = false;
    return;
  }
  gitLoading.value = true;
  try {
    const status = await window.api.git.status();
    isGit.value = status.isGitRepository;
    gitFiles.value = status.isGitRepository
      ? (status.files as GitRow[]).filter((f) => !f.ignored)
      : [];
    if (changeset.value === "uncommitted") {
      void refreshStats(gitFiles.value.map((f) => f.relativePath));
    }
  } catch {
    // Transient git hiccup (index.lock, …) — keep the last known list.
  } finally {
    gitLoading.value = false;
  }
}

/* ---- session / turn changesets ---- */

const turnFiles = computed(() => {
  const turns = collectTurnFileChanges(chat.activeMessages, toolCardFor, true);
  return [...turns.values()].pop()?.files ?? [];
});

function changeTypeForCode(code: string | null | undefined): ChangeType {
  switch (code) {
    case "A":
    case "U":
    case "C":
      return "added";
    case "D":
      return "deleted";
    default:
      return "modified";
  }
}

/* ---- unified rows (ChangesTree file items) ---- */

interface ChangeRow {
  path: string;
  changeType: ChangeType;
  additions: number | null;
  deletions: number | null;
}

const rows = computed<ChangeRow[]>(() => {
  if (changeset.value === "uncommitted") {
    const stats = statsMap.value;
    return gitFiles.value.map((f) => ({
      path: f.relativePath,
      changeType: changeTypeForCode(f.code),
      additions: stats.get(f.relativePath)?.additions ?? null,
      deletions: stats.get(f.relativePath)?.deletions ?? null,
    }));
  }
  const list = changeset.value === "session" ? sessionFiles.value : turnFiles.value;
  return list.map((f) => ({
    path: f.path,
    changeType: changeTypeForCode(gitCodeMap.value.get(f.path)),
    additions: f.additions,
    deletions: f.deletions,
  }));
});

const totalAdditions = computed(() =>
  rows.value.reduce((n, r) => n + (r.additions ?? 0), 0),
);
const totalDeletions = computed(() =>
  rows.value.reduce((n, r) => n + (r.deletions ?? 0), 0),
);

const diffStatsTooltip = computed(() =>
  t.changesDiffStats(
    t.changesFilesCount(rows.value.length),
    totalAdditions.value,
    totalDeletions.value,
  ),
);

function fileName(p: string): string {
  return p.split("/").pop() ?? p;
}

function fileDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "";
}

function badgeLetter(changeType: ChangeType): string {
  return changeType === "added" ? "A" : changeType === "deleted" ? "D" : "M";
}

function openDiff(row: ChangeRow): void {
  rightTabs.revealInChanges(row.path);
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
}

/** VS Code's row toolbar primary is Open File; holding Alt inverts to Open Changes. */
function onOpenFile(row: ChangeRow, ev: MouseEvent): void {
  if (ev.altKey) {
    openDiff(row);
    return;
  }
  previewStore.openPreview(row.path);
  rightTabs.addTab("preview", {
    filePath: row.path,
    label: fileName(row.path),
  });
}

/** ChangesDiffStatsAction — View All Changes. */
function openAllChanges(): void {
  const first = rows.value[0];
  if (first) openDiff(first);
}

function formatGitError(result: { message: string; code?: string }): string {
  const key = `gitErr_${result.code || "unknown"}` as keyof typeof t;
  return typeof t[key] === "string" ? (t[key] as string) : t.gitErr_unknown;
}

function onDiscard(row: ChangeRow): void {
  const d = dialog.warning({
    title: t.changesDiscardFile,
    content: t.changesDiscardConfirmFile,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return (async () => {
        try {
          const result = await window.api.git.restore([row.path]);
          if (!result.ok) {
            message.error(formatGitError(result));
            return false;
          }
          message.success(t.changesDiscarded);
          await refreshGit();
          return true;
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
          d.loading = false;
          return false;
        }
      })();
    },
  });
}

/* ---- refresh wiring ---- */

let fsTimer: ReturnType<typeof setTimeout> | null = null;

function onFsChanged(): void {
  if (!workspace.root || !props.visible) return;
  if (fsTimer) clearTimeout(fsTimer);
  fsTimer = setTimeout(() => {
    fsTimer = null;
    void refreshGit();
  }, 400);
}

onMounted(() => {
  void refreshGit();
  window.addEventListener("pi-fs-changed", onFsChanged);
});

onUnmounted(() => {
  window.removeEventListener("pi-fs-changed", onFsChanged);
  if (fsTimer) clearTimeout(fsTimer);
  statsSeq += 1;
});

watch(
  () => workspace.root,
  () => {
    statsMap.value = new Map();
    void refreshGit();
  },
);

watch(changeset, () => {
  void refreshGit();
});

watch(
  () => props.visible,
  (visible) => {
    if (visible) void refreshGit();
  },
);
</script>

<template>
  <div class="changes-view-body">
    <div class="changes-files-header">
      <div class="changes-files-header-toolbar">
        <NDropdown
          trigger="click"
          :options="changesetOptions"
          :render-label="renderChangesetLabel"
          @select="onChangesetSelect"
        >
          <button type="button" class="changes-picker" :title="pickerTooltip">
            <span class="changes-picker-label">{{ currentLabel }}</span>
            <NIcon :component="ChevronDownOutline" :size="12" class="changes-picker-chevron" />
          </button>
        </NDropdown>
      </div>
      <div class="changes-files-header-right-toolbar">
        <button
          v-if="rows.length"
          type="button"
          class="changes-diff-stats"
          :title="diffStatsTooltip"
          @click="openAllChanges"
        >
          <span class="changes-summary-widget">
            <span class="lines-added">+{{ totalAdditions }}</span>
            <span class="lines-removed">-{{ totalDeletions }}</span>
          </span>
        </button>
      </div>
    </div>

    <div v-if="gitLoading && changeset === 'uncommitted'" class="changes-progress" aria-hidden="true" />

    <div v-if="!rows.length" class="changes-welcome">
      <h2 class="sessions-empty-state-title">{{ t.changesWelcomeTitle }}</h2>
      <div class="sessions-empty-state-description">{{ t.changesWelcomeEmpty }}</div>
    </div>

    <ul v-else class="changes-file-list">
      <li
        v-for="row in rows"
        :key="row.path"
        class="row"
        :title="row.path"
        @click="openDiff(row)"
      >
        <NIcon :component="DocumentOutline" :size="14" class="file-icon" />
        <span class="label">
          <span class="name" :class="{ strike: row.changeType === 'deleted' }">{{
            fileName(row.path)
          }}</span>
          <span v-if="fileDir(row.path)" class="desc">{{ fileDir(row.path) }}</span>
        </span>
        <span v-if="row.additions !== null" class="working-set-line-counts">
          <span class="lines-added">+{{ row.additions }}</span>
          <span class="lines-removed">-{{ row.deletions }}</span>
        </span>
        <span class="chat-collapsible-list-action-bar">
          <button
            type="button"
            class="action"
            :title="t.changesOpenFile"
            @click.stop="onOpenFile(row, $event)"
          >
            <NIcon :component="OpenOutline" :size="13" />
          </button>
          <button
            v-if="changeset === 'uncommitted'"
            type="button"
            class="action"
            :title="t.changesDiscardFile"
            @click.stop="onDiscard(row)"
          >
            <NIcon :component="ArrowUndoOutline" :size="13" />
          </button>
        </span>
        <span class="changes-decoration-badge" :class="row.changeType">{{
          badgeLetter(row.changeType)
        }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Agents window Changes view (changesView.css / changesSummaryWidget.css) */

.changes-view-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 4px 8px;
  box-sizing: border-box;
  background: var(--bg-panel);
}

.changes-files-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  min-height: 22px;
  font-weight: 600;
  font-size: 11.5px;
  flex-shrink: 0;
}

.changes-files-header-toolbar {
  flex: 1;
  min-width: 0;
  display: flex;
}

.changes-picker {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  padding: 1px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}

.changes-picker:hover {
  background: var(--bg-hover);
}

.changes-picker-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.changes-picker-chevron {
  flex-shrink: 0;
  margin-left: 4px;
  color: var(--fg-muted);
}

.changes-files-header-right-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.changes-diff-stats {
  display: inline-flex;
  align-items: center;
  padding: 2px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}

.changes-diff-stats:hover {
  background: var(--bg-hover);
}

.changes-summary-widget {
  display: inline-flex;
  gap: 4px;
  font-variant-numeric: tabular-nums;
}

.lines-added {
  color: var(--git-u);
}

.lines-removed {
  color: var(--git-d);
}

/* ProgressBar — thin indeterminate line while the git changeset loads */
.changes-progress {
  position: relative;
  height: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

.changes-progress::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 33%;
  background: var(--accent, #4f8cff);
  animation: changes-progress-slide 1.2s ease-in-out infinite;
}

@keyframes changes-progress-slide {
  0% {
    left: -33%;
  }
  100% {
    left: 100%;
  }
}

/* Welcome — renderSessionsEmptyState */
.changes-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 32px;
  gap: 4px;
}

.sessions-empty-state-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: normal;
  color: var(--fg);
}

.sessions-empty-state-description {
  font-size: 12px;
  line-height: normal;
  color: var(--fg-muted);
}

.changes-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.row {
  display: flex;
  align-items: center;
  min-height: 22px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--fg);
  cursor: pointer;
}

.row:hover {
  background: var(--bg-hover);
}

.file-icon {
  flex-shrink: 0;
  margin-right: 4px;
  color: var(--fg-muted);
}

.label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
}

.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name.strike {
  text-decoration: line-through;
}

.desc {
  margin-left: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--fg-faint, var(--fg-muted));
}

/* Line counts — hidden on hover while the action bar has actions */
.working-set-line-counts {
  margin: 0 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.row:hover .working-set-line-counts,
.row:focus-within .working-set-line-counts {
  display: none;
}

.chat-collapsible-list-action-bar {
  padding-left: 6px;
  display: none;
  align-items: center;
  gap: 2px;
}

.row:hover .chat-collapsible-list-action-bar,
.row:focus-within .chat-collapsible-list-action-bar {
  display: inline-flex;
}

.action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.action:hover {
  background: var(--bg-active, var(--bg-hover));
  color: var(--fg);
}

/* A/M/D decoration badge — rightmost */
.changes-decoration-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  min-width: 16px;
  margin-right: 2px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.9;
}

.changes-decoration-badge.added {
  color: var(--git-u);
}

.changes-decoration-badge.modified {
  color: var(--git-m);
}

.changes-decoration-badge.deleted {
  color: var(--git-d);
}
</style>

<style>
/* Versions picker dropdown — teleported to <body>, mirrored on the VS Code
   action-widget list item (icon slot + title + optional detail line). */
.changes-dock-option {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 2px 0;
  min-width: 180px;
}

.changes-dock-option-check {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 20px;
}

.changes-dock-option-text {
  min-width: 0;
}

.changes-dock-option-label {
  font-size: 12px;
  line-height: 20px;
  white-space: nowrap;
}

.changes-dock-option-desc {
  font-size: 11px;
  line-height: 16px;
  color: var(--fg-muted);
  white-space: nowrap;
}
</style>
