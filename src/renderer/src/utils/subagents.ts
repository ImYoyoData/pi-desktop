/** 子代理页的数据源：task 卡结果、wait 卡里的 task 任务，按 agentId 合并。 */

import type { ChatMessage } from "../stores/chat-reducer";
import { toolCardFor } from "./tool-diff";

export type SubagentEntry = {
  agentId: string;
  label: string;
  status: "running" | "completed" | "failed" | "cancelled";
  durationMs: number;
};

/** 运行中优先，然后失败/取消，已完成的排最后；同状态按已运行时间降序。 */
const SUBAGENT_STATUS_ORDER: Record<SubagentEntry["status"], number> = {
  running: 0,
  failed: 1,
  cancelled: 2,
  completed: 3,
};

export function collectSubagents(
  messages: readonly ChatMessage[],
): SubagentEntry[] {
  const byId = new Map<string, SubagentEntry>();
  for (const message of messages) {
    if (message.role !== "tool") continue;
    const card = toolCardFor(message);
    if (card.kind === "detail") {
      for (const entry of card.transcripts) {
        if (!entry.agentId) continue;
        byId.set(entry.agentId, {
          agentId: entry.agentId,
          label: entry.label || entry.agentId,
          status: entry.status ?? (message.streaming ? "running" : "completed"),
          durationMs: entry.durationMs ?? 0,
        });
      }
    } else if (card.kind === "wait") {
      for (const job of card.jobs) {
        if (job.type !== "task" || !job.agentId) continue;
        byId.set(job.agentId, {
          agentId: job.agentId,
          label: job.intent || job.label || job.agentId,
          status: job.status,
          durationMs: job.durationMs,
        });
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) =>
      SUBAGENT_STATUS_ORDER[a.status] - SUBAGENT_STATUS_ORDER[b.status] ||
      b.durationMs - a.durationMs,
  );
}
