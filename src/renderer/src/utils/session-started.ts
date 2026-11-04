import type { SessionSummary } from "../../../shared/protocol";

/**
 * An "unstarted" session is one the user never talked to and never named:
 * the jsonl holds only the header row, so the summarizer reports no
 * firstMessage and the sidebar shows the default "新会话" label.
 * A manually renamed empty session is treated as intentional and kept.
 */
export function isUnstartedSession(session: SessionSummary | null | undefined): boolean {
  if (!session) return false;
  if (session.status === "running") return false;
  const first = session.firstMessage?.trim();
  if (first && first !== "(no messages)") return false;
  return !session.name?.trim();
}

/** 预热草稿与崩溃残留的空会话不上侧栏；活动会话始终保留。 */
export function visibleSessionRows(
  rows: SessionSummary[],
  activeId: string | null,
): SessionSummary[] {
  return rows.filter((row) => row.id === activeId || !isUnstartedSession(row));
}
