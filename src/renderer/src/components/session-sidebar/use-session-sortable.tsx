import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import Sortable from "sortablejs";
import type { SessionStatus, SessionSummary } from "../../../../shared/protocol";
import {
  compareSessionsOf,
  renumberSessionRanks,
  type SessionRanks,
} from "@renderer/utils/session-order";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import {
  SESSION_VISIBLE_LIMIT,
  type SessionView,
  type SidebarLocal,
} from "./sidebar-model";

type Params = {
  localRef: MutableRefObject<SidebarLocal>;
  draggingRoot: MutableRefObject<string | null>;
  view: SessionView;
  sessionsByRoot: Record<string, SessionSummary[]>;
  sessionListExpanded: Record<string, boolean>;
  workspacePaths: string[];
  workspacePathsKey: string;
  liveStatusOf: (row: SessionSummary) => SessionStatus;
  setSessionRanks: Dispatch<SetStateAction<SessionRanks>>;
  persistSessionRanks: (next: SessionRanks) => void;
  setPins: Dispatch<SetStateAction<Record<string, string[]>>>;
  persistPins: (next: Record<string, string[]>) => void;
};

/**
 * 侧栏拖拽排序：工作区列表与会话列表各一套 Sortable 实例。
 * 只负责 DOM 绑定与顺序落盘，排序权重/置顶状态仍由调用方持有。
 */
export function useSessionSortable({
  localRef,
  draggingRoot,
  view,
  sessionsByRoot,
  sessionListExpanded,
  workspacePaths,
  workspacePathsKey,
  liveStatusOf,
  setSessionRanks,
  persistSessionRanks,
  setPins,
  persistPins,
}: Params) {
  const sessionListEls = useRef(new Map<string, HTMLElement>());
  const sessionSortables = useRef(new Map<string, Sortable>());
  const sessionListRefCallbacks = useRef(
    new Map<string, (el: Element | null) => void>(),
  );
  const workspaceTreeEl = useRef<HTMLDivElement | null>(null);
  const workspaceSortable = useRef<Sortable | null>(null);

  /** 折叠或非「最近时间」视图下不给拖：拖出的顺序会被自动置顶覆盖。 */
  function isSessionDragDisabled(root: string): boolean {
    const local = localRef.current;
    return (
      local.view.sort !== "recent" ||
      (!local.sessionListExpanded[root] &&
        (local.sessionsByRoot[root]?.length ?? 0) > SESSION_VISIBLE_LIMIT)
    );
  }

  /** 拖动结束：可见行按新顺序排在前面，剩余行保持原相对顺序，整列重新编号。 */
  function reorderSessionsFromDrag(root: string, visibleIds: string[]): void {
    const local = localRef.current;
    const visible = new Set(visibleIds);
    const hidden = (local.sessionsByRoot[root] ?? [])
      .filter((row) => !visible.has(row.id))
      .map((row) => ({ ...row, status: liveStatusOf(row) }))
      .sort(compareSessionsOf(local.sessionRanks, local.pins, root, "recent"))
      .map((row) => row.id);
    const ordered = [...visibleIds, ...hidden];
    const next = renumberSessionRanks(local.sessionRanks, root, ordered);
    setSessionRanks(next);
    persistSessionRanks(next);
    const pinned = new Set(local.pins[root] ?? []);
    if (pinned.size) {
      const nextPins = {
        ...local.pins,
        [root]: ordered.filter((id) => pinned.has(id)),
      };
      setPins(nextPins);
      persistPins(nextPins);
    }
  }

  function bindSessionSortable(root: string): void {
    const el = sessionListEls.current.get(root);
    if (!el) return;
    sessionSortables.current.get(root)?.destroy();
    const sortable = Sortable.create(el, {
      animation: 150,
      draggable: "[data-session-row]",
      filter: "[data-no-session-drag]",
      disabled: isSessionDragDisabled(root),
      onStart: () => {
        draggingRoot.current = root;
      },
      onEnd: () => {
        draggingRoot.current = null;
        const ids = [
          ...el.querySelectorAll<HTMLElement>("[data-session-row][data-id]"),
        ]
          .map((n) => n.dataset.id)
          .filter((id): id is string => Boolean(id));
        if (ids.length) reorderSessionsFromDrag(root, ids);
      },
    });
    sessionSortables.current.set(root, sortable);
  }

  function sessionListRef(root: string): (el: Element | null) => void {
    let cb = sessionListRefCallbacks.current.get(root);
    if (!cb) {
      cb = (el: Element | null): void => {
        if (el instanceof HTMLElement) {
          sessionListEls.current.set(root, el);
          bindSessionSortable(root);
          return;
        }
        sessionSortables.current.get(root)?.destroy();
        sessionSortables.current.delete(root);
        sessionListEls.current.delete(root);
      };
      sessionListRefCallbacks.current.set(root, cb);
    }
    return cb;
  }

  function bindWorkspaceSortable(): void {
    workspaceSortable.current?.destroy();
    workspaceSortable.current = null;
    const el = workspaceTreeEl.current;
    if (!el) return;
    if (localRef.current.workspacePaths.length < 2) return;
    workspaceSortable.current = Sortable.create(el, {
      animation: 150,
      draggable: "[data-ws-block]",
      handle: "[data-ws-row]",
      filter: "[data-no-ws-drag]",
      preventOnFilter: false,
      onEnd: () => {
        const paths = [
          ...el.querySelectorAll<HTMLElement>("[data-ws-block][data-root]"),
        ]
          .map((n) => n.dataset.root)
          .filter((p): p is string => Boolean(p));
        const current = localRef.current.workspacePaths;
        if (paths.length !== current.length) return;
        const same = paths.every((p, i) => current[i] === p);
        if (same) return;
        void useWorkspaceStore.getState().reorderRecent(paths);
      },
    });
  }

  function destroySortables(): void {
    workspaceSortable.current?.destroy();
    workspaceSortable.current = null;
    for (const sortable of sessionSortables.current.values()) sortable.destroy();
    sessionSortables.current.clear();
    sessionListEls.current.clear();
  }

  useEffect(() => {
    bindWorkspaceSortable();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 工作区分组变化时重建，与原实现一致
  }, [workspacePathsKey, view.group]);

  useEffect(() => {
    for (const root of workspacePaths) {
      sessionSortables.current
        .get(root)
        ?.option("disabled", isSessionDragDisabled(root));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 排序条件变化时同步 disabled，与原实现一致
  }, [workspacePathsKey, sessionsByRoot, sessionListExpanded, view.group, view.sort]);

  return {
    workspaceTreeEl,
    sessionListRef,
    bindWorkspaceSortable,
    destroySortables,
  };
}
