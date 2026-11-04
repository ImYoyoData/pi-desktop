/** 读取子代理对话：运行中的 agent 走内存，已结束的走落盘 transcript。 */

import { existsSync } from "node:fs";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { loadSessionMessagesReadOnly } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { normalizeAgentTranscript } from "../shared/agent-transcript";
import { findAgentTranscriptFile, safeAgentId } from "../shared/agent-transcript-path";
import type { AgentTranscript } from "../shared/protocol";

export async function readAgentTranscript(
  agentId: string,
  sessionFile: string | null,
): Promise<AgentTranscript | null> {
  if (!safeAgentId(agentId)) return null;
  const ref = AgentRegistry.global().get(agentId);
  const live = ref?.session;
  if (live) {
    const stream = live.isStreaming ? live.agent.state.streamMessage : null;
    const messages = stream ? [...live.messages, stream] : live.messages;
    const normalized = normalizeAgentTranscript(messages, {
      live: live.isStreaming,
    });
    return {
      id: agentId,
      messages: normalized.entries,
      truncated: normalized.truncated,
      source: "live",
    };
  }
  const known = ref?.sessionFile;
  const file =
    known && existsSync(known) ? known : findAgentTranscriptFile(sessionFile, agentId);
  if (!file) return null;
  const messages = await loadSessionMessagesReadOnly(file);
  const normalized = normalizeAgentTranscript(messages);
  return {
    id: agentId,
    messages: normalized.entries,
    truncated: normalized.truncated,
    source: "disk",
  };
}
