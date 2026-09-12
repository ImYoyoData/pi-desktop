import type { SessionSummary } from "../../../shared/protocol";

export type SessionTreeGuide = "full" | "half";

export type SessionTreeItem = {
  session: SessionSummary;
  depth: number;
  /** 每个祖先层级一条竖向导线，长度等于 depth。 */
  guides: SessionTreeGuide[];
  /** 父会话 id（顶层为 undefined）。 */
  parentId?: string;
  hasChildren: boolean;
  /** 直接子会话数量。 */
  childCount: number;
};

/**
 * 按 parentSessionId 把扁平会话列表组成树并以前序拍平。
 * 父会话不在列表中或成环时按顶层处理；compare 作用于每个兄弟范围。
 */
export function buildSessionTree(
  list: SessionSummary[],
  compare: (a: SessionSummary, b: SessionSummary) => number,
): SessionTreeItem[] {
  const byId = new Map(list.map((s) => [s.id, s]));
  const childrenOf = new Map<string, SessionSummary[]>();
  const roots: SessionSummary[] = [];

  const isCycle = (start: SessionSummary): boolean => {
    const seen = new Set([start.id]);
    let cur = start;
    for (let hops = 0; hops < list.length; hops++) {
      const pid = cur.parentSessionId;
      if (!pid) return false;
      if (seen.has(pid)) return true;
      const next = byId.get(pid);
      if (!next) return false;
      seen.add(pid);
      cur = next;
    }
    return false;
  };

  for (const s of list) {
    const pid = s.parentSessionId;
    if (!pid || pid === s.id || !byId.has(pid) || isCycle(s)) {
      roots.push(s);
      continue;
    }
    const arr = childrenOf.get(pid) ?? [];
    arr.push(s);
    childrenOf.set(pid, arr);
  }

  roots.sort(compare);
  const items: SessionTreeItem[] = [];
  const visit = (
    node: SessionSummary,
    depth: number,
    pathLast: boolean[],
    parentId: string | undefined,
  ): void => {
    const kids = childrenOf.get(node.id) ?? [];
    const leaf = !kids.length;
    const guides: SessionTreeGuide[] = [];
    for (let i = 0; i < depth; i++) {
      let half = pathLast[i] ?? false;
      for (let j = i + 1; j < depth && half; j++) {
        half = half && (pathLast[j] ?? false);
      }
      guides.push(half && leaf ? "half" : "full");
    }
    items.push({
      session: node,
      depth,
      guides,
      parentId,
      hasChildren: !leaf,
      childCount: kids.length,
    });
    const sortedKids = kids.slice().sort(compare);
    sortedKids.forEach((kid, idx) => {
      visit(kid, depth + 1, [...pathLast, idx === sortedKids.length - 1], node.id);
    });
  };
  for (const root of roots) visit(root, 0, [], undefined);
  return items;
}
