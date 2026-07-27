import { defineStore } from "pinia";
import { onScopeDispose, reactive } from "vue";

export type CheckpointSummary = {
  sessionId: string;
  userMessageId: string;
  status: "capturing" | "ready" | "reverted" | "empty";
  fileCount: number;
  skippedCount: number;
};

function keyOf(sessionId: string, userMessageId: string): string {
  return `${sessionId}::${userMessageId}`;
}

export const useCheckpointStore = defineStore("checkpoint", () => {
  const byKey = reactive<Record<string, CheckpointSummary>>({});

  let bound = false;
  function bindEvents(): void {
    if (bound) return;
    bound = true;
    const off = window.api.checkpoint.onUpdated((summary) => {
      byKey[keyOf(summary.sessionId, summary.userMessageId)] = summary;
    });
    onScopeDispose(() => {
      bound = false;
      off();
    });
  }

  async function begin(sessionId: string, userMessageId: string): Promise<void> {
    const summary = await window.api.checkpoint.begin(sessionId, userMessageId);
    byKey[keyOf(sessionId, userMessageId)] = summary;
  }

  async function finishActive(sessionId: string): Promise<void> {
    const summary = await window.api.checkpoint.finishActive(sessionId);
    if (summary) {
      byKey[keyOf(summary.sessionId, summary.userMessageId)] = summary;
    }
  }

  function canRevert(sessionId: string, userMessageId: string): boolean {
    const s = byKey[keyOf(sessionId, userMessageId)];
    return s?.status === "ready" && s.fileCount > 0;
  }

  function isReverted(sessionId: string, userMessageId: string): boolean {
    return byKey[keyOf(sessionId, userMessageId)]?.status === "reverted";
  }

  /** Expose summary so templates can depend on byKey reactively. */
  function summaryFor(sessionId: string, userMessageId: string): CheckpointSummary | null {
    return byKey[keyOf(sessionId, userMessageId)] ?? null;
  }

  async function revert(sessionId: string, userMessageId: string) {
    const result = await window.api.checkpoint.revert(sessionId, userMessageId);
    const summary = await window.api.checkpoint.get(sessionId, userMessageId);
    if (summary) byKey[keyOf(sessionId, userMessageId)] = summary;
    return result;
  }

  return {
    byKey,
    bindEvents,
    begin,
    finishActive,
    canRevert,
    isReverted,
    summaryFor,
    revert,
  };
});
