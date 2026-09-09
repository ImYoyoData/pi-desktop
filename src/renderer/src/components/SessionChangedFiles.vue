<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import {
  ChevronDownOutline,
  ChevronForwardOutline,
  CreateOutline,
  DocumentTextOutline,
} from "@vicons/ionicons5";
import { useChatStore } from "@renderer/stores/chat";
import { useCheckpointStore } from "@renderer/stores/checkpoint";
import { useSessionsStore } from "@renderer/stores/sessions";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useLayoutStore } from "@renderer/stores/layout";
import { aggregateFileChanges, type SessionFileChange } from "@renderer/utils/session-file-changes";
import { t } from "@renderer/i18n";

/**
 * Copilot chat-editing "working set" — files the agent touched this session,
 * docked on the chat input stack above the composer. Header shows "<N> files
 * changed" + an aggregate +added/-removed pill (Copilot `.working-set-title`
 * + `.working-set-line-counts`); expanding lists every path with its own
 * +/- counts; clicking a row previews the file.
 *
 * Counts are the ACTUAL net change of each file (session-start baseline vs
 * its current on-disk content), so editing the same lines repeatedly or
 * rewriting a whole file does not inflate the totals. The transcript sums
 * (`aggregateFileChanges`) only stand in until the net stats arrive and when
 * no session-start baseline exists (e.g. history sessions loaded after a
 * restart).
 */

const chat = useChatStore();
const sessions = useSessionsStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const layout = useLayoutStore();

type NetStats = { additions: number; deletions: number };

/**
 * Streaming ticks recreate the message array every update; re-aggregating per
 * tick re-parses the live tool row O(content) each frame. Recompute on a
 * ~120ms trailing throttle instead — committed rows stay memoized anyway.
 */
const AGGREGATE_THROTTLE_MS = 120;
const files = ref<SessionFileChange[]>([]);
/** Actual-change stats already fetched from main (path → counts). */
const netStats = ref<Record<string, NetStats>>({});

function merged(list: SessionFileChange[]): SessionFileChange[] {
  const net = netStats.value;
  return list.map((f) => {
    const s = net[f.path];
    if (!s) return f;
    return { path: f.path, additions: s.additions, deletions: s.deletions };
  });
}

/**
 * Transcript totals gate which rows exist and provide the fallback numbers.
 * Prune net stats whose path vanished (e.g. history truncation) so stale
 * counts never resurface.
 */
function recompute(): void {
  const activeId = sessions.activeId;
  if (activeId !== lastActiveId) {
    lastActiveId = activeId;
    netStats.value = {};
    lastFetchKey = "";
  }
  const list = aggregateFileChanges(chat.activeMessages, chat.activeStreaming);
  const keep: Record<string, NetStats> = {};
  for (const f of list) {
    const s = netStats.value[f.path];
    if (s) keep[f.path] = s;
  }
  netStats.value = keep;
  files.value = merged(list);
  void refreshNetIfNeeded(list);
}

let lastCommitted: readonly unknown[] | null = null;
let lastFetchKey = "";
let fetchSeq = 0;
let lastActiveId: string | null = null;

/**
 * Reverting a turn restores files without touching the transcript; bump this
 * tick so the dock re-reads the disk state after any checkpoint lifecycle
 * event (begin / finish / revert).
 */
const checkpoint = useCheckpointStore();
let checkpointTick = 0;

/**
 * Fetch the real per-file change counts from main. Skipped while only the
 * streaming row mutates (its identity is stable) so a long-running turn does
 * not hammer IPC on every token tick.
 */
async function refreshNetIfNeeded(list: SessionFileChange[]): Promise<void> {
  const sessionId = sessions.activeId;
  if (!list.length || !sessionId) return;
  const committed = chat.activeMessages;
  const paths = list.map((f) => f.path);
  const key = `${sessionId}|${checkpointTick}|${committed === lastCommitted ? "s" : "c"}|${paths.join("\u0000")}`;
  lastCommitted = committed;
  if (key === lastFetchKey) return;
  lastFetchKey = key;
  const seq = ++fetchSeq;
  try {
    const res = await window.api.checkpoint.netSessionChanges(sessionId, paths);
    if (seq !== fetchSeq) return;
    const next: Record<string, NetStats> = {};
    for (const p of paths) {
      const s = res[p];
      if (s?.available) next[p] = { additions: s.additions, deletions: s.deletions };
    }
    netStats.value = next;
    files.value = merged(aggregateFileChanges(chat.activeMessages, chat.activeStreaming));
  } catch {
    // IPC hiccup — keep the transcript fallback until the next change.
  }
}

let aggregateTimer = 0;
function scheduleRecompute(): void {
  if (aggregateTimer) return;
  aggregateTimer = window.setTimeout(() => {
    aggregateTimer = 0;
    recompute();
  }, AGGREGATE_THROTTLE_MS);
}
watch(
  () => [chat.activeMessages, chat.activeStreaming] as const,
  () => scheduleRecompute(),
);
watch(
  () => checkpoint.byKey,
  () => {
    checkpointTick += 1;
    scheduleRecompute();
  },
  { deep: true },
);
onUnmounted(() => {
  if (aggregateTimer) window.clearTimeout(aggregateTimer);
  fetchSeq += 1;
});
recompute();

const collapsed = ref(true);

const totalAdditions = computed(() =>
  files.value.reduce((n, f) => n + f.additions, 0),
);
const totalDeletions = computed(() =>
  files.value.reduce((n, f) => n + f.deletions, 0),
);

const title = computed(() =>
  filesChangedLabel(files.value.length),
);

function filesChangedLabel(n: number): string {
  return n === 0 ? t.filesChanged : t.filesChangedCount(n);
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

function toggle(): void {
  collapsed.value = !collapsed.value;
}

function openFile(p: string): void {
  previewStore.openPreview(p);
  rightTabs.addTab("preview", {
    filePath: p,
    label: basename(p),
  });
  if (layout.rightCollapsed) layout.toggleRightCollapsed();
}
</script>

<template>
  <div
    v-if="files.length"
    class="files-dock"
    role="region"
    :aria-label="title"
    :class="{ expanded: !collapsed }"
  >
    <div class="files-dock-head">
      <button
        type="button"
        class="files-dock-toggle pi-interactive"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? t.filesExpand : t.filesCollapse"
        @click="toggle"
      >
        <NIcon
          class="chev"
          :component="collapsed ? ChevronForwardOutline : ChevronDownOutline"
          :size="13"
          aria-hidden="true"
        />
        <NIcon
          v-if="!collapsed"
          class="files-head-icon"
          :component="CreateOutline"
          :size="13"
          aria-hidden="true"
        />
        <span class="files-title">{{ title }}</span>
        <span
          v-if="totalAdditions || totalDeletions"
          class="files-line-counts"
        >
          <span v-if="totalAdditions" class="lines-added">
            +{{ totalAdditions }}
          </span>
          <span v-if="totalDeletions" class="lines-removed">
            -{{ totalDeletions }}
          </span>
        </span>
      </button>
    </div>

    <Transition name="files-expand">
      <div v-show="!collapsed" class="files-dock-body">
        <ul class="files-list" role="list">
          <li
            v-for="f in files"
            :key="f.path"
            class="files-item"
            role="listitem"
            @click="openFile(f.path)"
          >
            <NIcon
              class="file-glyph"
              :component="DocumentTextOutline"
              :size="14"
              aria-hidden="true"
            />
            <span class="file-path" :title="f.path">{{ basename(f.path) }}</span>
            <span class="files-item-counts">
              <span v-if="f.additions" class="lines-added">+{{ f.additions }}</span>
              <span v-if="f.deletions" class="lines-removed">-{{ f.deletions }}</span>
            </span>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot chat-editing working set — docked slice on the input
   stack. Border/radius come from the enclosing .chat-input-stack. */

.files-dock {
  flex-shrink: 0;
  min-width: 0;
  background: transparent;
}

.files-dock-head {
  display: flex;
  align-items: center;
}

.files-dock-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 6px 0 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
  font: inherit;
  user-select: none;
}

.files-dock-toggle:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.chev {
  flex-shrink: 0;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.files-head-icon {
  flex-shrink: 0;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.files-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--chat-font-s, 12px);
  font-weight: 500;
  line-height: 22px;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.files-dock-toggle:hover .files-title {
  color: var(--fg);
}

.files-line-counts {
  flex-shrink: 0;
  display: inline-flex;
  gap: 3px;
  margin-right: 6px;
  font-size: var(--chat-font-xs, 11px);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.lines-added {
  color: var(--git-u, var(--success, var(--green)));
}

.lines-removed {
  color: var(--git-d, var(--red, #ef4444));
}

.files-dock-body {
  min-width: 0;
  padding: 0 6px 6px;
}

.files-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 198px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong, var(--border)) transparent;
}

.files-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: var(--chat-font-s, 12px);
  color: var(--fg);
  cursor: pointer;
}

.files-item:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.file-glyph {
  flex-shrink: 0;
  color: var(--chat-icon-fg, var(--fg-muted));
}

.file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files-item-counts {
  flex-shrink: 0;
  display: inline-flex;
  gap: 3px;
  margin-right: 4px;
  font-size: var(--chat-font-xs, 11px);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.files-expand-enter-active,
.files-expand-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms ease;
  overflow: hidden;
}

.files-expand-enter-from,
.files-expand-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}

@media (prefers-reduced-motion: reduce) {
  .files-expand-enter-active,
  .files-expand-leave-active {
    transition: none;
  }
}
</style>
