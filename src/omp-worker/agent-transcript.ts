/** 读取子代理对话：运行中的 agent 走内存，已结束的走落盘 transcript。 */

import { existsSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { loadSessionMessagesReadOnly } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { normalizeAgentMessages } from "../shared/agent-transcript";
import type { AgentTranscript } from "../shared/protocol";

const JSONL_SUFFIX = ".jsonl";
const MAX_SCAN_DEPTH = 2;

function safeAgentId(agentId: string): boolean {
  return Boolean(agentId) && !agentId.includes("..") && !/[\\/]/.test(agentId);
}

/** 子代理 transcript 位于 `<artifactsDir>/<id>.jsonl`，嵌套子代理再深一层。 */
function findTranscript(dir: string, agentId: string, depth: number): string | null {
  const direct = path.join(dir, `${agentId}${JSONL_SUFFIX}`);
  if (existsSync(direct)) return direct;
  if (depth >= MAX_SCAN_DEPTH) return null;
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name.endsWith(`.${agentId}${JSONL_SUFFIX}`)) {
        return path.join(dir, entry.name);
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    const found = findTranscript(path.join(dir, entry.name), agentId, depth + 1);
    if (found) return found;
  }
  return null;
}

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
    return { id: agentId, messages: normalizeAgentMessages(messages), source: "live" };
  }
  const known = ref?.sessionFile;
  const file = known && existsSync(known) ? known : findSessionArtifact(sessionFile, agentId);
  if (!file) return null;
  const messages = await loadSessionMessagesReadOnly(file);
  return { id: agentId, messages: normalizeAgentMessages(messages), source: "disk" };
}

/** omp 的 artifacts 目录与桌面附件目录都放在会话文件旁边，两个都试。 */
function findSessionArtifact(sessionFile: string | null, agentId: string): string | null {
  if (!sessionFile?.endsWith(JSONL_SUFFIX)) return null;
  const candidates = [
    sessionFile.slice(0, -JSONL_SUFFIX.length),
    `${sessionFile}.attachments`,
  ];
  for (const dir of candidates) {
    const found = findTranscript(dir, agentId, 0);
    if (found) return found;
  }
  return null;
}
