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
import { useCallback, useEffect, useRef, useState } from "react";
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

export function useSessionFileChanges(): { files: SessionFileChange[] } {
  const activeMessages = useChatStore((s) => s.activeMessages);
  const activeStreaming = useChatStore((s) => s.activeStreaming);
  const byKey = useCheckpointStore((s) => s.byKey);

  const [files, setFiles] = useState<SessionFileChange[]>([]);
  const netStats = useRef<Record<string, NetStats>>({});
  const lastCommitted = useRef<readonly unknown[] | null>(null);
  const lastFetchKey = useRef("");
  const fetchSeq = useRef(0);
  const lastActiveId = useRef<string | null>(null);
  /** Checkpoint lifecycle (begin/finish/revert) invalidates net stats. */
  const checkpointTick = useRef(0);
  const aggregateTimer = useRef(0);

  const merged = useCallback((list: SessionFileChange[]): SessionFileChange[] => {
    const net = netStats.current;
    return list.map((f) => {
      const s = net[f.path];
      if (!s) return f;
      return { path: f.path, additions: s.additions, deletions: s.deletions };
    });
  }, []);

  /**
   * Fetch the real per-file change counts from main. Skipped while only the
   * streaming row mutates (its identity is stable) so a long-running turn does
   * not hammer IPC on every token tick.
   */
  const refreshNetIfNeeded = useCallback(
    async (list: SessionFileChange[]): Promise<void> => {
      const sessionId = useSessionsStore.getState().activeId;
      if (!list.length || !sessionId) return;
      const committed = useChatStore.getState().activeMessages;
      const paths = list.map((f) => f.path);
      const key = `${sessionId}|${checkpointTick.current}|${committed === lastCommitted.current ? "s" : "c"}|${paths.join(String.fromCharCode(0))}`;
      lastCommitted.current = committed;
      if (key === lastFetchKey.current) return;
      lastFetchKey.current = key;
      const seq = ++fetchSeq.current;
      try {
        const res = await window.api.checkpoint.netSessionChanges(sessionId, paths);
        if (seq !== fetchSeq.current) return;
        const next: Record<string, NetStats> = {};
        for (const p of paths) {
          const s = res[p];
          if (s?.available) next[p] = { additions: s.additions, deletions: s.deletions };
        }
        netStats.current = next;
        const chatState = useChatStore.getState();
        setFiles(
          merged(aggregateFileChanges(chatState.activeMessages, chatState.activeStreaming)),
        );
      } catch {
        // IPC hiccup — keep the transcript fallback until the next change.
      }
    },
    [merged],
  );

  /**
   * Transcript totals gate which rows exist and provide the fallback numbers.
   * Prune net stats whose path vanished (e.g. history truncation) so stale
   * counts never resurface.
   */
  const recompute = useCallback((): void => {
    const chatState = useChatStore.getState();
    const activeId = useSessionsStore.getState().activeId;
    if (activeId !== lastActiveId.current) {
      lastActiveId.current = activeId;
      netStats.current = {};
      lastFetchKey.current = "";
    }
    const list = aggregateFileChanges(chatState.activeMessages, chatState.activeStreaming);
    const keep: Record<string, NetStats> = {};
    for (const f of list) {
      const s = netStats.current[f.path];
      if (s) keep[f.path] = s;
    }
    netStats.current = keep;
    setFiles(merged(list));
    void refreshNetIfNeeded(list);
  }, [merged, refreshNetIfNeeded]);

  const scheduleRecompute = useCallback((): void => {
    if (aggregateTimer.current) return;
    aggregateTimer.current = window.setTimeout(() => {
      aggregateTimer.current = 0;
      recompute();
    }, AGGREGATE_THROTTLE_MS);
  }, [recompute]);

  useEffect(() => {
    scheduleRecompute();
  }, [activeMessages, activeStreaming, scheduleRecompute]);

  useEffect(() => {
    checkpointTick.current += 1;
    scheduleRecompute();
  }, [byKey, scheduleRecompute]);

  useEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    return () => {
      if (aggregateTimer.current) window.clearTimeout(aggregateTimer.current);
      fetchSeq.current += 1;
    };
  }, []);

  return { files };
}
