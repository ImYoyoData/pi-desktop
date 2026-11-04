/** 子代理转录文件定位：主进程与 omp worker 共用同一套路径规则。 */

import { existsSync, readdirSync, type Dirent } from "node:fs";
import path from "node:path";

const JSONL_SUFFIX = ".jsonl";
const MAX_SCAN_DEPTH = 2;

export function safeAgentId(agentId: string): boolean {
  return Boolean(agentId) && !agentId.includes("..") && !/[\\/]/.test(agentId);
}

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

export function findAgentTranscriptFile(
  sessionFile: string | null,
  agentId: string,
): string | null {
  if (!safeAgentId(agentId) || !sessionFile?.endsWith(JSONL_SUFFIX)) return null;
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
