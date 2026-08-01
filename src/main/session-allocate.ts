import { ensureSessionFileOnDisk } from "../agent-worker/session-file";

/** Create a Pi session jsonl on disk without starting an agent worker. */
export async function allocateSessionOnDisk(cwd: string): Promise<{
  id: string;
  cwd: string;
  filePath: string;
}> {
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const sm = SessionManager.create(cwd);
  ensureSessionFileOnDisk(sm);
  const filePath = sm.getSessionFile()?.trim();
  if (!filePath) {
    throw new Error("failed to allocate session file");
  }
  return {
    id: sm.getSessionId(),
    cwd: sm.getCwd(),
    filePath,
  };
}
