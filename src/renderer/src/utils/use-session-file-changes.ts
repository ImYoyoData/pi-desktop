/**
 * Live "files changed in this agent session" list — the Copilot working-set
 * equivalent, shared by the chat input dock (SessionChangedFiles) and the
 * right-pane Changes dock view.
 *
 * Rows come from the transcript aggregate (`aggregateFileChanges`) and are
 * merged with the REAL per-file net stats (session-start baseline vs current
 * on-disk content, via `checkpoint.netSessionChanges`) as soon as they arrive.
 * Because the transcript only grows, its per-file sums over-count repeated
 * edits of the same lines — the net path exists to correct that.
 */
import { ref, watch, onUnmounted } from "vue";
import { useChatStore } from "@renderer/stores/chat";
import { useCheckpointStore } from "@renderer/stores/checkpoint";
import { useSessionsStore } from "@renderer/stores/sessions";
import {
  aggregateFileChanges,
  type SessionFileChange,
} from "./session-file-changes";

type NetStats = { additions: number; deletions: number };

/** Streaming ticks recreate the message array every update; re-aggregating per
 * tick re-parses the live tool row O(content) each frame. Recompute on a
 * ~120ms trailing throttle instead — committed rows stay memoized anyway. */
const AGGREGATE_THROTTLE_MS = 120;

export function useSessionFileChanges() {
  const chat = useChatStore();
  const sessions = useSessionsStore();
  const checkpoint = useCheckpointStore();

  const files = ref<SessionFileChange[]>([]);
  /** Actual-change stats already fetched from main (path → counts). */
  const netStats = ref<Record<string, NetStats>>({});

  let lastCommitted: readonly unknown[] | null = null;
  let lastFetchKey = "";
  let fetchSeq = 0;
  let lastActiveId: string | null = null;
  /** Checkpoint lifecycle (begin/finish/revert) invalidates net stats. */
  let checkpointTick = 0;
  let aggregateTimer = 0;

  function merged(list: SessionFileChange[]): SessionFileChange[] {
    const net = netStats.value;
    return list.map((f) => {
      const s = net[f.path];
      if (!s) return f;
      return { path: f.path, additions: s.additions, deletions: s.deletions };
    });
  }

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
    const key = `${sessionId}|${checkpointTick}|${committed === lastCommitted ? "s" : "c"}|${paths.join(String.fromCharCode(0))}`;
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

  return { files };
}
