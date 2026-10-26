import type { SessionStatus, SessionSummary } from "../../../shared/protocol";

export type SessionSort = "created" | "recent";

/** 每个工作区里会话的排序权重：值越大越靠前。 */
export type SessionRanks = Record<string, Record<string, number>>;

/** 拖动排序后整列重新编号的步长，留出自动置顶插队的空间。 */
export const SESSION_RANK_STEP = 1000;

function isRunning(status: SessionStatus): boolean {
  return status === "running";
}

/**
 * 排序权重：手动顺序与自动置顶共用同一个数字键，缺省回退到最近活动时间。
 * 创建时间排序不读权重——它就是字面的创建时间。
 */
export function sessionRankOf(
  session: SessionSummary,
  ranks: Record<string, number> | undefined,
  sort: SessionSort,
): number {
  if (sort === "created") {
    return Date.parse(session.created ?? session.modified) || 0;
  }
  const stored = ranks?.[session.id];
  if (typeof stored === "number") return stored;
  return Date.parse(session.modified) || 0;
}

export function compareSessionsOf(
  sessionRanks: SessionRanks,
  pins: Record<string, string[]>,
  root: string,
  sort: SessionSort,
): (a: SessionSummary, b: SessionSummary) => number {
  const ranks = sessionRanks[root];
  const pinMap = new Map((pins[root] ?? []).map((id, i) => [id, i]));
  const pinRank = (session: SessionSummary): number =>
    pinMap.get(session.id) ?? Number.MAX_SAFE_INTEGER;
  return (a, b) => {
    const ap = pinRank(a);
    const bp = pinRank(b);
    if (ap !== bp) return ap - bp;
    // 运行中的会话整体压在已结束会话之上，收尾的任务才不会被顶到运行中任务下面
    if (sort === "recent") {
      const ar = isRunning(a.status) ? 0 : 1;
      const br = isRunning(b.status) ? 0 : 1;
      if (ar !== br) return ar - br;
    }
    const aRank = sessionRankOf(a, ranks, sort);
    const bRank = sessionRankOf(b, ranks, sort);
    if (aRank !== bRank) return bRank - aRank;
    return a.id.localeCompare(b.id);
  };
}

/** 把会话抬到工作区最前，多个 id 按传入顺序自上而下。 */
export function bumpSessionRanks(
  sessionRanks: SessionRanks,
  root: string,
  sessionIds: string[],
  now = Date.now(),
): SessionRanks {
  if (!sessionIds.length) return sessionRanks;
  const map = { ...(sessionRanks[root] ?? {}) };
  const max = Object.values(map).reduce((m, v) => Math.max(m, v), 0);
  let cursor = Math.max(now, max + SESSION_RANK_STEP);
  for (const id of sessionIds) {
    map[id] = cursor;
    cursor -= 1;
  }
  return { ...sessionRanks, [root]: map };
}

/**
 * 按给定顺序整列重新编号：未列入的会话按旧权重接在后面，
 * 保证手动拖动后它们不会被缺省时间戳顶到最前。
 */
export function renumberSessionRanks(
  sessionRanks: SessionRanks,
  root: string,
  orderedIds: string[],
  now = Date.now(),
): SessionRanks {
  const map = { ...(sessionRanks[root] ?? {}) };
  const listed = new Set(orderedIds);
  const rest = Object.keys(map)
    .filter((id) => !listed.has(id))
    .sort((a, b) => map[b] - map[a]);
  const base = Object.values(map).reduce((m, v) => Math.max(m, v), now);
  [...orderedIds, ...rest].forEach((id, i) => {
    map[id] = base - i * SESSION_RANK_STEP;
  });
  return { ...sessionRanks, [root]: map };
}
