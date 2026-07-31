import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * Pi only flushes a new session jsonl after the first assistant message.
 * Desktop idle-destroys workers earlier; cold-open then hits SessionManager.open on a
 * missing path, which silently creates a *new* session id → sessions:open mismatch.
 * Persist the header immediately, then reload so the manager marks itself flushed.
 */
export function ensureSessionFileOnDisk(sessionManager: SessionManager): void {
  const file = sessionManager.getSessionFile()?.trim();
  const header = sessionManager.getHeader();
  if (!file || !header) return;
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(header)}\n`, "utf8");
  }
  // Reload so internal `flushed` is true and later appends use appendFileSync.
  sessionManager.setSessionFile(file);
}

/** Open an existing session file — never invent a new id for a missing path. */
export function openExistingSessionFile(
  SessionManagerCtor: typeof SessionManager,
  filePath: string,
  cwd: string,
): SessionManager {
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error("session file path is empty");
  }
  if (!existsSync(trimmed)) {
    throw new Error(`session file not found: ${trimmed}`);
  }
  return SessionManagerCtor.open(trimmed, undefined, cwd);
}
