import fs from "node:fs/promises";
import type { SessionHistoryMessage } from "../shared/protocol";

type ParsedEntry = {
  id: string;
  parentId: string | null;
  timestamp: string;
  type: string;
  message?: Record<string, unknown>;
};

function textFromAgentMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter((part): part is { type: string; text: string } => {
      return Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text");
    })
    .map((part) => part.text)
    .join("");
}

function thinkingFromAgentMessage(message: Record<string, unknown>): string {
  const content = message.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; thinking: string } => {
      return (
        Boolean(part) &&
        typeof part === "object" &&
        (part as { type?: string }).type === "thinking" &&
        typeof (part as { thinking?: unknown }).thinking === "string"
      );
    })
    .map((part) => part.thinking)
    .join("");
}

function findLeafId(entries: ParsedEntry[]): string | null {
  const hasChild = new Set<string>();
  for (const entry of entries) {
    if (entry.parentId) {
      hasChild.add(entry.parentId);
    }
  }
  const leaves = entries.filter((entry) => entry.id && !hasChild.has(entry.id));
  if (leaves.length === 0) {
    return null;
  }
  leaves.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return leaves[0]?.id ?? null;
}

export async function readSessionHistoryMessages(filePath: string): Promise<SessionHistoryMessage[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }

  const entries: ParsedEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof parsed.type !== "string" || typeof parsed.id !== "string") {
      continue;
    }
    entries.push({
      id: parsed.id,
      parentId: typeof parsed.parentId === "string" ? parsed.parentId : null,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
      type: parsed.type,
      message:
        parsed.message && typeof parsed.message === "object"
          ? (parsed.message as Record<string, unknown>)
          : undefined,
    });
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let leafId = findLeafId(entries);
  const pathIds: string[] = [];
  while (leafId) {
    pathIds.push(leafId);
    const entry = byId.get(leafId);
    leafId = entry?.parentId ?? null;
  }
  pathIds.reverse();

  const messages: SessionHistoryMessage[] = [];
  for (const id of pathIds) {
    const entry = byId.get(id);
    if (!entry || entry.type !== "message" || !entry.message) {
      continue;
    }
    const role = entry.message.role;
    if (role === "user") {
      const text = textFromAgentMessage(entry.message);
      if (text) {
        messages.push({ id: entry.id, role: "user", text });
      }
    } else if (role === "assistant") {
      const text = textFromAgentMessage(entry.message);
      const thinking = thinkingFromAgentMessage(entry.message);
      if (text || thinking) {
        messages.push({
          id: entry.id,
          role: "assistant",
          text,
          ...(thinking ? { thinking } : {}),
        });
      }
    }
  }

  return messages;
}

export async function deleteSessionFile(filePath: string): Promise<void> {
  await fs.unlink(filePath);
}
