/** 主进程直接读盘上的子代理转录，避免为只读查询冷启动 worker。 */

import { readFile } from "node:fs/promises";
import { normalizeAgentTranscript } from "../shared/agent-transcript";
import { findAgentTranscriptFile } from "../shared/agent-transcript-path";
import type { AgentTranscript } from "../shared/protocol";

export async function readAgentTranscriptFromDisk(
  sessionFile: string | null,
  agentId: string,
): Promise<AgentTranscript | null> {
  const file = findAgentTranscriptFile(sessionFile, agentId);
  if (!file) return null;
  const raw = await readFile(file, "utf8");
  const messages: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: { type?: unknown; message?: unknown };
    try {
      entry = JSON.parse(line) as { type?: unknown; message?: unknown };
    } catch {
      continue;
    }
    if (entry.type !== "message" || !entry.message) continue;
    messages.push(entry.message);
  }
  const normalized = normalizeAgentTranscript(messages);
  return {
    id: agentId,
    messages: normalized.entries,
    truncated: normalized.truncated,
    source: "disk",
  };
}
