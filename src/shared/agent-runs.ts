export type AgentRunId = string;

export type AgentRunStatus = "running" | "terminating";

/** Snapshot pushed to renderer (tail already capped). */
export type AgentRunSnapshot = {
  id: AgentRunId;
  sessionId: string;
  workspaceRoot: string;
  command: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  status: AgentRunStatus;
  outputTail: string;
  /**
   * True once the bash tool call has detached (conversation no longer waits).
   * Process may still be alive — shown in Running panel.
   */
  detached?: boolean;
};

export type AgentRunEvent =
  | { type: "upsert"; run: AgentRunSnapshot }
  | { type: "output"; runId: AgentRunId; chunk: string; outputTail: string }
  | { type: "ended"; runId: AgentRunId }
  | { type: "snapshot"; runs: AgentRunSnapshot[] };

const MAX_TAIL_CHARS = 512 * 1024;

/** Cap ring buffer used by main registry; worker may send raw chunks. */
export function appendCappedTail(prev: string, chunk: string, max = MAX_TAIL_CHARS): string {
  const next = prev + chunk;
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}
