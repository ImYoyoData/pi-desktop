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
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { parentPort } from "node:worker_threads";
import {
  chatMetaPath,
  type SessionChatMeta,
  type SessionChatMetaEntry,
} from "../shared/chat-meta";
import type {
  SessionHistoryMessage,
  SessionHistoryPage,
} from "../shared/protocol";
import {
  parseSessionHistoryJsonl,
  parseSessionHistoryPageFromJsonl,
} from "./session-history-parse";

type Job = {
  filePath?: string;
  page?: { limit?: number; beforeId?: string | null };
  listDir?: string;
  listAllUnder?: string;
};

export type DiskSessionRow = {
  id: string;
  filePath: string;
  cwd: string;
  name?: string;
  modified: string;
  firstMessage: string;
};

type Reply =
  | { ok: true; messages: SessionHistoryMessage[] }
  | { ok: true; page: SessionHistoryPage }
  | { ok: true; sessions: DiskSessionRow[] }
  | { ok: false; error: string };

function readChatMetaEntries(filePath: string): SessionChatMetaEntry[] {
  const path = chatMetaPath(filePath);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(
      readFileSync(path, "utf8"),
    ) as Partial<SessionChatMeta>;
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

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        Boolean(block) &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join(" ");
}

function summarizeSessionFile(filePath: string): DiskSessionRow | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    let header: Record<string, unknown> | null = null;
    let name: string | undefined;
    let firstMessage = "";
    let lastActivityTime: number | undefined;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!header) {
        if (entry.type !== "session" || typeof entry.id !== "string")
          return null;
        header = entry;
        continue;
      }
      if (entry.type === "session_info") {
        const rawName = (entry as { name?: unknown }).name;
        name =
          typeof rawName === "string" && rawName.trim()
            ? rawName.trim()
            : undefined;
        continue;
      }
      if (entry.type !== "message") continue;
      const message = (entry as { message?: unknown }).message;
      if (!message || typeof message !== "object") continue;
      const msg = message as {
        role?: unknown;
        content?: unknown;
        timestamp?: unknown;
      };
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const msgTimestamp = msg.timestamp;
      const activityTime =
        typeof msgTimestamp === "number"
          ? msgTimestamp
          : new Date(String(entry.timestamp ?? "")).getTime();
      if (typeof activityTime === "number" && !Number.isNaN(activityTime)) {
        lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
      }
      const text = extractTextContent(msg.content);
      if (!text) continue;
      if (!firstMessage && msg.role === "user") {
        firstMessage = text;
      }
    }
    if (!header) return null;
    const headerTime = new Date(String(header.timestamp ?? "")).getTime();
    const modified =
      typeof lastActivityTime === "number" && lastActivityTime > 0
        ? new Date(lastActivityTime)
        : !Number.isNaN(headerTime)
          ? new Date(headerTime)
          : statSync(filePath).mtime;
    return {
      id: String(header.id),
      filePath,
      cwd: typeof header.cwd === "string" ? header.cwd : "",
      name,
      modified: modified.toISOString(),
      firstMessage: firstMessage || "(no messages)",
    };
  } catch {
    return null;
  }
}

function listSessionSummaries(dirs: string[]): DiskSessionRow[] {
  const rows: DiskSessionRow[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(dir, f));
    } catch {
      continue;
    }
    for (const file of files) {
      const row = summarizeSessionFile(file);
      if (row) rows.push(row);
    }
  }
  rows.sort((a, b) => b.modified.localeCompare(a.modified));
  return rows;
}

function listAllSessionDirs(sessionsRoot: string): string[] {
  try {
    return readdirSync(sessionsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(sessionsRoot, e.name));
  } catch {
    return [];
  }
}

parentPort?.on("message", (job: Job) => {
  try {
    if (typeof job?.listDir === "string") {
      reply({ ok: true, sessions: listSessionSummaries([job.listDir]) });
      return;
    }
    if (typeof job?.listAllUnder === "string") {
      reply({
        ok: true,
        sessions: listSessionSummaries(listAllSessionDirs(job.listAllUnder)),
      });
      return;
    }
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
