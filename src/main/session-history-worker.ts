/**
 * Worker-thread session history parse: reads jsonl + UI meta off the main
 * process so switching large sessions never freezes the desktop UI.
 *
 * Job:
 *   { filePath: string }
 *     → full leaf-path messages
 *   { filePath: string, page: { limit: number; beforeId?: string | null } }
 *     → SessionHistoryPage (images only for the returned window)
 *
 * Reply:
 *   { ok: true, messages } | { ok: true, page } | { ok: false, error }
 */
import { readFileSync, existsSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { chatMetaPath, type SessionChatMeta, type SessionChatMetaEntry } from "../shared/chat-meta";
import type { SessionHistoryMessage, SessionHistoryPage } from "../shared/protocol";
import {
  parseSessionHistoryJsonl,
  parseSessionHistoryPageFromJsonl,
} from "./session-history-parse";

type Job = {
  filePath: string;
  page?: { limit?: number; beforeId?: string | null };
};
type Reply =
  | { ok: true; messages: SessionHistoryMessage[] }
  | { ok: true; page: SessionHistoryPage }
  | { ok: false; error: string };

function readChatMetaEntries(filePath: string): SessionChatMetaEntry[] {
  const path = chatMetaPath(filePath);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<SessionChatMeta>;
    if (!Array.isArray(parsed?.entries)) return [];
    return parsed.entries.filter(
      (e) => e && typeof e.text === "string" && Array.isArray(e.tags),
    ) as SessionChatMetaEntry[];
  } catch {
    return [];
  }
}

function reply(msg: Reply): void {
  parentPort?.postMessage(msg);
}

parentPort?.on("message", (job: Job) => {
  try {
    if (!job?.filePath || typeof job.filePath !== "string") {
      throw new Error("history worker: missing filePath");
    }
    const raw = readFileSync(job.filePath, "utf8");
    const chatMeta = readChatMetaEntries(job.filePath);
    if (job.page) {
      const limit =
        typeof job.page.limit === "number" && Number.isFinite(job.page.limit)
          ? job.page.limit
          : 30;
      const page = parseSessionHistoryPageFromJsonl(raw, {
        limit,
        beforeId: job.page.beforeId,
        chatMeta,
      });
      reply({ ok: true, page });
      return;
    }
    const messages = parseSessionHistoryJsonl(raw, chatMeta);
    reply({ ok: true, messages });
  } catch (err) {
    reply({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
