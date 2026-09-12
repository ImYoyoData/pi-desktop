<script setup lang="ts">
/**
 * Right-pane dock "Changes" view — uncommitted git changes only, styled 1:1
 * on the VS Code Agents window Changes view pane
 * (src/vs/sessions/contrib/changes/browser/changesView.ts).
 *
 * Header = the right-aligned diff stats (+A −D, tooltip "{N files}, A
 * additions, D deletions", click = View All Changes). Rows are VS Code
 * changes-tree file items: file icon + name + muted relative-dir description
 * (name gets the space first; strikethrough when deleted), +N −N counts that
 * hide on hover when the inline action bar has actions, a hover toolbar
 * (Open File, Alt = Open Changes; discard) and the rightmost A/M/D
 * decoration badge. Empty state is the uniform "Changes / No changed files"
 * welcome.
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NIcon, useDialog, useMessage } from "naive-ui";
import {
  ArrowUndoOutline,
  DocumentOutline,
  OpenOutline,
} from "@vicons/ionicons5";
import { useLayoutStore } from "@renderer/stores/layout";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const props = withDefaults(
  defineProps<{
    /** False while the dock is hidden — defer git refreshes. */
    visible?: boolean;
  }>(),
  { visible: true },
);

type ChangeType = "added" | "modified" | "deleted";

const workspace = useWorkspaceStore();
const layout = useLayoutStore();
const rightTabs = useRightTabsStore();
const previewStore = usePreviewStore();
const message = useMessage();
const dialog = useDialog();

/* ---- git working tree rows ---- */

type GitRow = { relativePath: string; code: string; ignored?: boolean };

const gitLoading = ref(false);
const gitFiles = ref<GitRow[]>([]);
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
    return;
  }
  gitLoading.value = true;
  try {
    const status = await window.api.git.status();
    gitFiles.value = status.isGitRepository
      ? (status.files as GitRow[]).filter((f) => !f.ignored)
      : [];
    void refreshStats(gitFiles.value.map((f) => f.relativePath));
  } catch {
    // Transient git hiccup (index.lock, …) — keep the last known list.
  } finally {
    gitLoading.value = false;
  }
}

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

/* ---- rows (VS Code changes-tree file items) ---- */

interface ChangeRow {
  path: string;
  changeType: ChangeType;
  additions: number | null;
  deletions: number | null;
}

const rows = computed<ChangeRow[]>(() => {
  const stats = statsMap.value;
  return gitFiles.value.map((f) => ({
    path: f.relativePath,
    changeType: changeTypeForCode(f.code),
    additions: stats.get(f.relativePath)?.additions ?? null,
    deletions: stats.get(f.relativePath)?.deletions ?? null,
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
      <div class="changes-files-header-toolbar" />
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

    <div v-if="gitLoading" class="changes-progress" aria-hidden="true" />

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

/* Name gets the space first — it never yields to the dir description. */
.name {
  flex: 0 0 auto;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name.strike {
  text-decoration: line-through;
}

.desc {
  flex: 0 1 auto;
  min-width: 0;
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
