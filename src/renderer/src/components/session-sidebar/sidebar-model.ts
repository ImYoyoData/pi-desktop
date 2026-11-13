import type { MenuProps } from "antd";
import type { SessionStatus, SessionSummary } from "../../../../shared/protocol";
import type { WorkspaceState } from "@renderer/stores/workspace";
import { buildSessionTree, type SessionTreeItem } from "@renderer/utils/session-tree";
import type { SessionRanks, SessionSort } from "@renderer/utils/session-order";
import * as prefs from "@renderer/utils/prefs";

export const PIN_KEY = "session-pins:v1";
export const SESSION_RANK_KEY = "pi-desktop:session-rank:v1";
export const SESSION_VIEW_KEY = "pi-desktop:session-view:v1";
export const SESSION_VISIBLE_LIMIT = 5;

/** 侧栏视图：分组 / 时间范围 / 排序。 */
export type SessionViewGroup = "project" | "task";
export type SessionViewTime = "all" | "1d" | "3d" | "7d";
export type SessionViewSort = SessionSort;

export type SessionView = {
  group: SessionViewGroup;
  time: SessionViewTime;
  sort: SessionViewSort;
};

export const DEFAULT_SESSION_VIEW: SessionView = {
  group: "project",
  time: "all",
  sort: "recent",
};

const SESSION_VIEW_TIME_MS: Record<Exclude<SessionViewTime, "all">, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function loadSessionView(): SessionView {
  try {
    const raw = prefs.getItem(SESSION_VIEW_KEY);
    if (!raw) return DEFAULT_SESSION_VIEW;
    const parsed = JSON.parse(raw) as Partial<SessionView>;
    return {
      group: parsed.group === "task" ? "task" : "project",
      time:
        parsed.time === "1d" || parsed.time === "3d" || parsed.time === "7d"
          ? parsed.time
          : "all",
      sort: parsed.sort === "created" ? "created" : "recent",
    };
  } catch {
    return DEFAULT_SESSION_VIEW;
  }
}

/** 上下文菜单的大致高度：用来判断按钮下方是否放得下。 */
export const CTX_MENU_HEIGHT = 220;

export type MenuItem = NonNullable<MenuProps["items"]>[number];

export type ArchivedRow = {
  id: string;
  label: string;
  workspace: string;
  modified: string;
};

export type ContextMenuState = {
  show: boolean;
  x: number;
  y: number;
  placement: "bottomLeft" | "bottomRight" | "topRight";
  kind: "workspace" | "session";
  root: string;
  session: SessionSummary | null;
};

export type VisibleSessionItem = SessionTreeItem & {
  /** 所属顶层会话 id：悬停任一层级时整组显示导线。 */
  topId: string | null;
  /** 每个祖先层级：竖线是否贯穿整行（末级否则画弯头，中间级否则不画）。 */
  guideFull: boolean[];
  /** 是否为父级的最后一个子会话（末级导线以圆角弯头收尾）。 */
  isLastSibling: boolean;
};

export type SidebarLocal = {
  sessionsByRoot: Record<string, SessionSummary[]>;
  sessionRanks: SessionRanks;
  pins: Record<string, string[]>;
  sessionListExpanded: Record<string, boolean>;
  selectMode: boolean;
  selectedSessionIds: string[];
  workspacePaths: string[];
  view: SessionView;
};

/** 侧栏展示的工作区：最近列表 + 活动工作区兜底。 */
export function workspacePathsOf(workspace: WorkspaceState): string[] {
  const paths = [...workspace.recent];
  const root = workspace.root;
  if (
    root?.trim() &&
    !paths.some((p) => p.toLowerCase() === root.toLowerCase())
  ) {
    paths.push(root);
  }
  return paths;
}

export function isRunning(status: SessionStatus): boolean {
  return status === "running";
}

export function sameWorkspacePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

export function relativeTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/** 剔除已归档会话：父会话归档时其派生会话一并隐藏，保持树完整。 */
export function visibleSessionsOfList(
  list: SessionSummary[],
  archivedIds: Set<string>,
): SessionSummary[] {
  if (!archivedIds.size) return list;
  const byId = new Map(list.map((s) => [s.id, s]));
  const isArchived = (start: SessionSummary): boolean => {
    let cur: SessionSummary | undefined = start;
    for (let hops = 0; cur && hops <= list.length; hops++) {
      if (archivedIds.has(cur.id)) return true;
      cur = cur.parentSessionId ? byId.get(cur.parentSessionId) : undefined;
    }
    return false;
  };
  return list.filter((s) => !isArchived(s));
}

/** 时间过滤：按最近活动时间（modified）取窗口，全部时不过滤。 */
export function withinSessionViewTime(item: SessionSummary, time: SessionViewTime): boolean {
  if (time === "all") return true;
  const parsed = Date.parse(item.modified);
  if (Number.isNaN(parsed)) return true;
  return Date.now() - parsed <= SESSION_VIEW_TIME_MS[time];
}

export function topSessionsOf(
  list: SessionSummary[],
  archivedIds: Set<string>,
  compare: (a: SessionSummary, b: SessionSummary) => number,
): SessionSummary[] {
  return buildSessionTree(visibleSessionsOfList(list, archivedIds), compare)
    .filter((item) => item.depth === 0)
    .map((item) => item.session);
}

export function hasOpenModalMask(): boolean {
  return (
    document.querySelector(".ant-modal-mask") !== null ||
    document.querySelector(".ant-drawer-mask") !== null
  );
}
