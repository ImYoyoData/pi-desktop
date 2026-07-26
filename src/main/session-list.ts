import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { SessionSummary } from "../shared/protocol";

export function resolveAgentDir(): string {
  return getAgentDir();
}

/** Matches Pi SDK default session directory encoding under ~/.pi/agent/sessions/. */
export function encodeCwdSessionDir(cwd: string, agentDir?: string): string {
  const resolvedCwd = path.resolve(cwd);
  const resolvedAgentDir = path.resolve(agentDir ?? resolveAgentDir());
  const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(resolvedAgentDir, "sessions", safePath);
}

function sessionInfoToSummary(info: {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  modified: Date;
  firstMessage: string;
}): SessionSummary {
  return {
    id: info.id,
    filePath: info.path,
    cwd: info.cwd,
    name: info.name,
    modified: info.modified.toISOString(),
    firstMessage: info.firstMessage,
    status: "idle",
  };
}

export async function listSessionsForCwd(cwd: string): Promise<SessionSummary[]> {
  const resolvedCwd = path.resolve(cwd);
  const infos = await SessionManager.list(resolvedCwd);
  return infos
    .filter((info) => {
      const sessionCwd = info.cwd ? path.resolve(info.cwd) : resolvedCwd;
      return sessionCwd === resolvedCwd;
    })
    .map(sessionInfoToSummary)
    .sort((a, b) => b.modified.localeCompare(a.modified));
}
