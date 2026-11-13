import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import {
  ChatboxOutline,
  CopyOutline,
  CreateOutline,
  FolderOpenOutline,
  FolderOutline,
  ListOutline,
  RefreshOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import type { SessionStatus, SessionSummary } from "../../../../shared/protocol";
import { SESSION_HISTORY_INITIAL_LIMIT } from "../../../../shared/protocol";
import type { AgentBackend } from "../../../../shared/agent-backend";
import { currentBackend } from "@renderer/utils/current-backend";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { useChatStore } from "@renderer/stores/chat";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useLayoutStore } from "@renderer/stores/layout";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import {
  isUnstartedSession,
  visibleSessionRows,
} from "@renderer/utils/session-started";
import { isTextEntryTarget } from "@renderer/utils/keyboard-target";
import { buildSessionTree, type SessionTreeItem } from "@renderer/utils/session-tree";
import {
  bumpSessionRanks,
  compareSessionsOf,
  sessionRankOf,
  type SessionRanks,
} from "@renderer/utils/session-order";
import { markRendererStartup } from "@renderer/utils/startup-timing";
import * as prefs from "@renderer/utils/prefs";
import { registerStateApplier } from "@renderer/utils/state-sync";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  useDialog,
  useMessage,
  type DialogHandle,
} from "@renderer/services/feedback";
import { SessionRow } from "./SessionRow";
import { useSessionSortable } from "./use-session-sortable";
import { useArchivedSessions } from "./use-archived-sessions";
import {
  CTX_MENU_HEIGHT,
  DEFAULT_SESSION_VIEW,
  PIN_KEY,
  SESSION_RANK_KEY,
  SESSION_VIEW_KEY,
  SESSION_VISIBLE_LIMIT,
  hasOpenModalMask,
  isRunning,
  loadSessionView,
  sameWorkspacePath,
  topSessionsOf,
  visibleSessionsOfList,
  withinSessionViewTime,
  workspacePathsOf,
  type ContextMenuState,
  type MenuItem,
  type SessionView,
  type SessionViewGroup,
  type SessionViewSort,
  type SessionViewTime,
  type SidebarLocal,
  type VisibleSessionItem,
} from "./sidebar-model";

export function useSessionSidebar() {
  const t = useI18n();
  const dialog = useDialog();
  const message = useMessage();

  const sessionsStore = useSessionsStore();
  const workspace = useWorkspaceStore();

  /** 主进程给出的最新状态（按会话 id，与工作区无关）。 */
  const statusBySession = sessionsStore.statusBySession;

  const pendingAskKey = useChatStore((s) => {
    const ids: string[] = [];
    for (const [id, state] of Object.entries(s.bySession)) {
      if (state.pendingAskUser || state.pendingExtensionUi || state.pendingPermission) ids.push(id);
    }
    return ids.sort().join(",");
  });

  /** 点击即生效的选中态：高亮/标题/树联动先跟随它，真正的会话切换在后台完成。 */
  const selectedSessionId =
    sessionsStore.pendingActiveId ?? sessionsStore.activeId;

  const activeSession = useMemo(
    () =>
      selectedSessionId
        ? (sessionsStore.sessions.find((s) => s.id === selectedSessionId) ??
          null)
        : null,
    [selectedSessionId, sessionsStore.sessions],
  );
  const showStuckRecovery = activeSession?.status === "stuck";

  const [sessionsByRoot, setSessionsByRoot] = useState<
    Record<string, SessionSummary[]>
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pins, setPins] = useState<Record<string, string[]>>({});
  const [sessionRanks, setSessionRanks] = useState<SessionRanks>({});
  const [sessionListExpanded, setSessionListExpanded] = useState<
    Record<string, boolean>
  >({});
  const [treeCollapsed, setTreeCollapsed] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [hoverGuides, setHoverGuides] = useState<Record<string, string | null>>(
    {},
  );
  const [justEnded, setJustEnded] = useState<Set<string>>(new Set());

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTarget, setRenameTarget] = useState<{
    root: string;
    id: string;
  } | null>(null);
  const [wsRenameOpen, setWsRenameOpen] = useState(false);
  const [wsRenameDraft, setWsRenameDraft] = useState("");
  const [wsRenameRoot, setWsRenameRoot] = useState<string | null>(null);

  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);

  const [view, setView] = useState<SessionView>(loadSessionView);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [selectAnchorId, setSelectAnchorId] = useState<string | null>(null);


  const [ctx, setCtx] = useState<ContextMenuState>({
    show: false,
    x: 0,
    y: 0,
    placement: "bottomLeft",
    kind: "workspace",
    root: "",
    session: null,
  });

  const archivedIds = useMemo(
    () => new Set(workspace.archivedSessions),
    [workspace.archivedSessions],
  );
  const workspacePaths = useMemo(
    () => workspacePathsOf(workspace),
    [workspace],
  );
  const workspacePathsKey = workspacePaths.join("\0");
  const activeBackend = currentBackend();

  const localRef = useRef<SidebarLocal>({
    sessionsByRoot,
    sessionRanks,
    pins,
    sessionListExpanded,
    selectMode,
    selectedSessionIds,
    workspacePaths,
    view,
  });

  useEffect(() => {
    localRef.current = {
      sessionsByRoot,
      sessionRanks,
      pins,
      sessionListExpanded,
      selectMode,
      selectedSessionIds,
      workspacePaths,
      view,
    };
  });

  const prevStatuses = useRef(new Map<string, SessionStatus>());
  const draggingRoot = useRef<string | null>(null);
  const skipAutoSelectRoot = useRef<string | null>(null);

  const {
    workspaceTreeEl,
    sessionListRef,
    bindWorkspaceSortable,
    destroySortables,
  } = useSessionSortable({
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
  });

  const {
    archivedOpen,
    setArchivedOpen,
    archivedFilteredRows,
    archivedQuery,
    setArchivedQuery,
    archivedSelected,
    onArchivedRowClick,
    toggleArchivedSelect,
    restoreSelectedArchived,
    deleteSelectedArchived,
    openArchivedList,
  } = useArchivedSessions({
    workspacePaths,
    localRef,
    sessionLabel,
    workspaceName,
    rootOfSession,
    loadSessions,
    ensureActiveSession,
  });

  function sessionLabel(session: {
    name?: string;
    firstMessage?: string;
    id: string;
  }): string {
    if (session.name?.trim()) return session.name.trim();
    if (session.firstMessage?.trim() && session.firstMessage !== "(no messages)") {
      const text = session.firstMessage.trim();
      return text.length > 42 ? `${text.slice(0, 39)}…` : text;
    }
    return t.newSession;
  }

  function hasPendingAsk(sessionId: string): boolean {
    if (!pendingAskKey) return false;
    return pendingAskKey.split(",").includes(sessionId);
  }

  function persistPins(next: Record<string, string[]>): void {
    prefs.setItem(PIN_KEY, JSON.stringify(next));
  }

  function loadPins(): void {
    try {
      const raw = prefs.getItem(PIN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        next[k] = Array.isArray(v) ? v : [];
      }
      setPins(next);
    } catch {
      // ignore
    }
  }

  function persistSessionRanks(next: SessionRanks): void {
    prefs.setItem(SESSION_RANK_KEY, JSON.stringify(next));
  }

  function loadSessionRanks(): void {
    try {
      const raw = prefs.getItem(SESSION_RANK_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: SessionRanks = {};
      for (const [root, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") continue;
        const map: Record<string, number> = {};
        for (const [id, rank] of Object.entries(value as Record<string, unknown>)) {
          if (typeof rank === "number" && Number.isFinite(rank)) map[id] = rank;
        }
        next[root] = map;
      }
      setSessionRanks(next);
    } catch {
      // ignore
    }
  }

  /** 把会话抬到所在工作区最前，多个 id 按传入顺序自上而下。 */
  function bumpSessionsToFront(root: string, sessionIds: string[]): void {
    if (!sessionIds.length || draggingRoot.current === root) return;
    setSessionRanks((prev) => {
      const next = bumpSessionRanks(prev, root, sessionIds);
      if (next !== prev) persistSessionRanks(next);
      return next;
    });
  }

  function isPinned(root: string, id: string): boolean {
    return (pins[root] ?? []).includes(id);
  }

  function togglePin(root: string, id: string): void {
    const list = [...(pins[root] ?? [])];
    const idx = list.indexOf(id);
    if (idx >= 0) list.splice(idx, 1);
    else list.unshift(id);
    const next = { ...pins, [root]: list };
    setPins(next);
    persistPins(next);
  }

  function compareSessions(
    root: string,
  ): (a: SessionSummary, b: SessionSummary) => number {
    return compareSessionsOf(sessionRanks, pins, root, view.sort);
  }

  /**
   * 会话行的状态取自主进程镜像：侧栏同时展示多个工作区，
   * 缓存行里的状态只在加载那一刻准确，镜像才跟得上运行/收尾。
   */
  function liveStatusOf(row: SessionSummary): SessionStatus {
    return statusBySession[row.id] ?? row.status;
  }

  /** 缓存行统一套上实时状态，排序与渲染才会跟运行状态一致。 */
  function rowsOf(root: string): SessionSummary[] {
    return (sessionsByRoot[root] ?? []).map((row) => ({
      ...row,
      status: liveStatusOf(row),
    }));
  }

  function visibleSessions(root: string): SessionSummary[] {
    return visibleSessionsOfList(rowsOf(root), archivedIds).filter((row) =>
      withinSessionViewTime(row, view.time),
    );
  }

  function visibleTreeItemsFor(root: string): VisibleSessionItem[] {
    const items = buildSessionTree(
      visibleSessions(root),
      compareSessions(root),
    );
    let visible = items;
    const collapsed = treeCollapsed[root];
    if (collapsed && Object.keys(collapsed).length) {
      const parentOf = new Map(items.map((i) => [i.session.id, i.parentId]));
      const isHidden = (item: SessionTreeItem): boolean => {
        let pid = item.parentId;
        for (let hops = 0; pid && hops < items.length; hops++) {
          if (collapsed[pid]) return true;
          pid = parentOf.get(pid);
        }
        return false;
      };
      visible = items.filter((item) => !isHidden(item));
    }
    const rootCount = visible.reduce(
      (n, item) => (item.depth === 0 ? n + 1 : n),
      0,
    );
    if (!sessionListExpanded[root] && rootCount > SESSION_VISIBLE_LIMIT) {
      let seenRoots = 0;
      visible = visible.filter((item) => {
        if (item.depth === 0) seenRoots += 1;
        return seenRoots <= SESSION_VISIBLE_LIMIT;
      });
    }
    const parentOf = new Map(visible.map((i) => [i.session.id, i.parentId]));
    const topIdOf = (id: string): string | null => {
      let top: string | null = null;
      let cur: string | null | undefined = id;
      for (let hops = 0; cur && hops <= visible.length; hops++) {
        top = cur;
        cur = parentOf.get(cur);
      }
      return top;
    };
    return visible.map((item) => ({
      ...item,
      topId: topIdOf(item.session.id),
      guideFull: item.lastFlags.map((last) => !last),
      isLastSibling: item.lastFlags[item.depth - 1] ?? false,
    }));
  }

  function sessionsFor(root: string): SessionSummary[] {
    return topSessionsOf(rowsOf(root), archivedIds, compareSessions(root));
  }

  /** 侧栏可见会话的渲染顺序，Shift 范围选择按它取区间。 */
  const visibleSessionIds = ((): string[] => {
    if (view.group === "task") {
      return flatTaskRows().map((row) => row.item.session.id);
    }
    const ids: string[] = [];
    for (const root of workspacePaths) {
      for (const item of visibleTreeItemsFor(root)) ids.push(item.session.id);
    }
    return ids;
  })();

  function isTreeNodeCollapsed(root: string, sessionId: string): boolean {
    return Boolean(treeCollapsed[root]?.[sessionId]);
  }

  function toggleTreeNode(root: string, sessionId: string): void {
    setTreeCollapsed((prev) => {
      const map = { ...(prev[root] ?? {}) };
      map[sessionId] = !map[sessionId];
      return { ...prev, [root]: map };
    });
  }

  function onSessionRowEnter(root: string, item: VisibleSessionItem): void {
    if (item.topId) setHoverGuides((prev) => ({ ...prev, [root]: item.topId }));
  }

  function onSessionRowLeave(root: string): void {
    setHoverGuides((prev) => ({ ...prev, [root]: null }));
  }

  /** 会话 id 归并到所属顶层会话（选中会话常驻显示其层级导线）。 */
  function topIdOfSession(root: string, sessionId: string | null): string | null {
    if (!sessionId) return null;
    const list = sessionsByRoot[root] ?? [];
    const parentOf = new Map(list.map((s) => [s.id, s.parentSessionId]));
    let top: string | null = null;
    let cur: string | null | undefined = sessionId;
    for (let hops = 0; cur && hops <= list.length; hops++) {
      top = cur;
      cur = parentOf.get(cur);
    }
    return top;
  }

  function guidesVisibleFor(root: string, item: VisibleSessionItem): boolean {
    if (!item.topId) return false;
    return (
      hoverGuides[root] === item.topId ||
      topIdOfSession(root, selectedSessionId) === item.topId
    );
  }

  function collapsibleSessionCount(root: string): number {
    return Math.max(0, sessionsFor(root).length - SESSION_VISIBLE_LIMIT);
  }

  function hiddenSessionCount(root: string): number {
    if (sessionListExpanded[root]) return 0;
    return collapsibleSessionCount(root);
  }

  /** 丢弃会话已不存在的排序权重，避免权重表随删除无限制增长。 */
  function pruneSessionRanks(root: string, alive: Set<string>): void {
    const current = localRef.current.sessionRanks[root];
    if (!current) return;
    const ids = Object.keys(current);
    if (ids.every((id) => alive.has(id))) return;
    const map = { ...current };
    for (const id of ids) {
      if (!alive.has(id)) delete map[id];
    }
    const next = { ...localRef.current.sessionRanks, [root]: map };
    setSessionRanks(next);
    persistSessionRanks(next);
  }

  async function loadSessions(root: string): Promise<SessionSummary[]> {
    markRendererStartup("renderer:sessions-request");
    const rows = await window.api.sessions.list(root, currentBackend());
    // 预热草稿是主进程里的活动记录，会混进列表；侧栏只展示正式会话。
    const list = visibleSessionRows(
      rows,
      useSessionsStore.getState().activeId,
    );
    setSessionsByRoot((prev) => ({ ...prev, [root]: list }));
    pruneSessionRanks(root, new Set(list.map((s) => s.id)));
    useSessionsStore.getState().replaceList(root, list);
    useSessionWidgetsStore
      .getState()
      .pruneStaleTodoSnapshots(new Set(list.map((s) => s.id)));
    markRendererStartup("renderer:ready");
    return list;
  }

  async function ensureActiveSession(
    root: string,
    autoOpenFirst = true,
    loaded?: SessionSummary[],
  ): Promise<void> {
    const sessions = useSessionsStore.getState();
    // 草稿态没有真实会话：同一工作区保留，切到别的目录则放弃。
    if (sessions.draftRoot) {
      if (sameWorkspacePath(sessions.draftRoot, root)) return;
      useSessionsStore.setState({ draftRoot: null });
    }
    const list = loaded ?? localRef.current.sessionsByRoot[root] ?? [];
    if (sessions.activeId && list.some((s) => s.id === sessions.activeId)) {
      // Re-open so main-process broker always has the session (cold start / HMR).
      await onSelectSession(root, sessions.activeId, list);
      return;
    }
    if (!autoOpenFirst) return;
    const first = topSessionsOf(
      [...list],
      new Set(useWorkspaceStore.getState().archivedSessions),
      compareSessionsOf(
        localRef.current.sessionRanks,
        localRef.current.pins,
        root,
        localRef.current.view.sort,
      ),
    )[0];
    if (first) await onSelectSession(root, first.id, list);
  }

  function workspaceName(path: string): string {
    const alias = workspace.aliases[path]?.trim();
    if (alias) return alias;
    const parts = path.replace(/\\/g, "/").split("/");
    return parts.filter(Boolean).pop() ?? path;
  }

  async function onWorkspaceClick(path: string): Promise<void> {
    const wasExpanded = Boolean(expanded[path]);
    const currentRoot = useWorkspaceStore.getState().root;
    if (currentRoot !== path) {
      // Leaving the current workspace also abandons an unstarted 新会话 there.
      await discardActiveUnstartedForRoot(currentRoot);
      skipAutoSelectRoot.current = path;
      const next = await useWorkspaceStore
        .getState()
        .openWorkspacePath(path);
      // 切换成功后由 root watcher 统一加载并展开，避免重复加载造成列表二次渲染；
      // 未切换（如拒绝信任）时仍允许展开查看列表
      if (next === path) return;
      setExpanded((prev) => ({ ...prev, [path]: true }));
      await loadSessions(path);
      return;
    }
    const nextExpanded = !wasExpanded;
    setExpanded((prev) => ({ ...prev, [path]: nextExpanded }));
    if (nextExpanded) await loadSessions(path);
  }

  async function onNewAgent(): Promise<void> {
    let root = useWorkspaceStore.getState().root;
    if (!root) root = await useWorkspaceStore.getState().openWorkspace();
    if (!root) return;
    await onNewAgentForWorkspace(root);
  }

  async function onNewAgentForWorkspace(
    root: string,
    event?: { stopPropagation: () => void; preventDefault: () => void },
  ): Promise<void> {
    event?.stopPropagation();
    event?.preventDefault();
    useLayoutStore.getState().showChat();
    const currentRoot = useWorkspaceStore.getState().root;
    // 在别的目录新建会放弃当前未使用的空会话。
    if (currentRoot && currentRoot !== root) {
      await discardActiveUnstartedForRoot(currentRoot);
    }
    if (currentRoot !== root) {
      await useWorkspaceStore.getState().openWorkspacePath(root);
    }
    if (!useWorkspaceStore.getState().sessionsReady) return;
    setExpanded((prev) => ({ ...prev, [root]: true }));
    useSessionsStore.getState().beginDraft(root);
  }

  async function onAddWorkspace(): Promise<void> {
    const root = await useWorkspaceStore.getState().openWorkspace();
    if (!root) return;
    setExpanded((prev) => ({ ...prev, [root]: true }));
    await loadSessions(root);
  }

  /**
   * 切换全局智能体后端：所有工作区一起换引擎。
   * pi 与 omp 的会话目录不同，换后端后每个工作区的列表都得重载。
   */
  async function switchBackend(backend: AgentBackend): Promise<void> {
    if (currentBackend() === backend) return;
    const root = useWorkspaceStore.getState().root;
    if (root) await discardActiveUnstartedForRoot(root);
    await useWorkspaceStore.getState().setBackend(backend);
    const roots = new Set([
      ...Object.keys(localRef.current.sessionsByRoot),
      ...(root ? [root] : []),
    ]);
    await Promise.all([...roots].map((r) => loadSessions(r)));
    if (root) useSessionsStore.getState().beginDraft(root);
  }

  /** Discard the active session (of a root) when the user leaves it unstarted. */
  async function discardActiveUnstartedForRoot(
    root: string | null,
  ): Promise<void> {
    if (!root) return;
    const id = useSessionsStore.getState().activeId;
    if (!id) return;
    const row =
      (localRef.current.sessionsByRoot[root] ?? []).find((s) => s.id === id) ??
      useSessionsStore.getState().sessions.find((s) => s.id === id) ??
      null;
    if (row && isUnstartedSession(row)) {
      await discardUnstartedSession(root, id);
    }
  }

  /** Delete an unstarted (never-chatted, never-renamed) session silently. */
  async function discardUnstartedSession(
    root: string,
    sessionId: string,
  ): Promise<void> {
    const sessions = useSessionsStore.getState();
    const stillThere =
      sessions.sessions.some((s) => s.id === sessionId) ||
      (localRef.current.sessionsByRoot[root] ?? []).some(
        (s) => s.id === sessionId,
      );
    if (!stillThere) return;
    try {
      await sessions.deleteSession(sessionId, root);
      useChatStore.getState().clearSession(sessionId);
      useSendQueueStore.getState().clearSession(sessionId);
      const nextPins = {
        ...localRef.current.pins,
        [root]: (localRef.current.pins[root] ?? []).filter(
          (id) => id !== sessionId,
        ),
      };
      setPins(nextPins);
      persistPins(nextPins);
      const currentRanks = localRef.current.sessionRanks[root];
      if (currentRanks?.[sessionId] !== undefined) {
        const map = { ...currentRanks };
        delete map[sessionId];
        const next = { ...localRef.current.sessionRanks, [root]: map };
        setSessionRanks(next);
        persistSessionRanks(next);
      }
      setSessionsByRoot((prev) => ({
        ...prev,
        [root]: (prev[root] ?? []).filter((s) => s.id !== sessionId),
      }));
    } catch (err) {
      console.error("discard unstarted session failed", err);
    }
  }

  const selectToken = useRef(0);

  async function onSelectSession(
    root: string,
    sessionId: string,
    loaded?: SessionSummary[],
  ): Promise<void> {
    // 连点只认最后一次：旧请求回来时不再改 activeId / 消息区，避免多余的整树渲染。
    const token = ++selectToken.current;
    useLayoutStore.getState().showChat();
    // 高亮立刻切，切换会话本身在后台继续。
    useSessionsStore.getState().setPendingActiveId(sessionId);
    const sessions = useSessionsStore.getState();
    // An active 新会话 the user never chatted with is dropped when they leave it
    // (click another session / switch workspace) instead of lingering on disk.
    const leavingId = sessions.activeId;
    let leaving: SessionSummary | null = null;
    let leavingRoot = "";
    if (leavingId && leavingId !== sessionId) {
      // The active row may live in another workspace's cached tree while the
      // workspace switch is reloading the store list — locate it anywhere.
      for (const [r, rows] of Object.entries(localRef.current.sessionsByRoot)) {
        const found = rows.find((s) => s.id === leavingId);
        if (found) {
          leaving = found;
          leavingRoot = r;
          break;
        }
      }
      if (!leaving) {
        leaving = sessions.sessions.find((s) => s.id === leavingId) ?? null;
        leavingRoot = leaving?.cwd || useWorkspaceStore.getState().root || root;
      }
    }
    const discardLeaving = Boolean(leaving && isUnstartedSession(leaving));
    // Cross-workspace clicks must discard BEFORE the root switch wipes the store
    // list; same-workspace discards wait until the new session is active so the
    // UI never flashes an empty state between the two IPC round-trips.
    if (discardLeaving && useWorkspaceStore.getState().root !== root) {
      await discardUnstartedSession(leavingRoot, leaving!.id);
    }
    // 消息区整体换内容是一次大渲染；Zustand 走 useSyncExternalStore（SyncLane），
    // startTransition 延后不了这次提交，这里直接同步标记，避免误导。
    useChatStore.getState().beginHistoryLoad(sessionId);
    try {
      if (useWorkspaceStore.getState().root !== root) {
        await useWorkspaceStore.getState().openWorkspacePath(root);
      }
      const opened =
        (loaded ?? localRef.current.sessionsByRoot[root] ?? []).find(
          (s) => s.id === sessionId,
        ) ?? useSessionsStore.getState().sessions.find((s) => s.id === sessionId);
      // Load history from disk in parallel with opening the session in main:
      // history only needs the file path, so the two round-trips no longer stack.
      const historyPromise = opened?.filePath
        ? window.api.sessions.history(opened.filePath, {
          limit: SESSION_HISTORY_INITIAL_LIMIT,
        })
        : Promise.resolve({ messages: [], hasMore: false, total: 0 });
      const [page] = await Promise.all([
        historyPromise,
        useSessionsStore.getState().selectSession(sessionId, root),
      ]);
      if (token !== selectToken.current) return;
      useChatStore
        .getState()
        .hydrateFromHistory(sessionId, page.messages, page.hasMore);
      if (discardLeaving && useWorkspaceStore.getState().root === root) {
        await discardUnstartedSession(leavingRoot, leaving!.id);
      }
    } catch (err) {
      if (token === selectToken.current) {
        useSessionsStore.getState().setPendingActiveId(null);
      }
      console.error("select session failed", err);
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      if (token === selectToken.current) {
        useChatStore.getState().endHistoryLoad(sessionId);
      }
    }
  }

  /** 定位会话所在工作区：侧栏缓存 → store 列表 → 主进程下发的 cwd（列表未加载时唯一线索）。 */
  function resolveNotifyRoot(sessionId: string, cwd?: string): string | null {
    const known =
      rootOfSession(sessionId) ??
      useSessionsStore.getState().sessions.find((s) => s.id === sessionId)
        ?.cwd ??
      null;
    if (known) return known;
    if (!cwd) return null;
    const recent = workspacePathsOf(useWorkspaceStore.getState());
    return recent.find((p) => sameWorkspacePath(p, cwd)) ?? cwd;
  }

  async function onNotifyOpenSession(
    sessionId: string,
    cwd?: string,
  ): Promise<void> {
    const root = resolveNotifyRoot(sessionId, cwd);
    if (!root) return;
    await onSelectSession(root, sessionId);
  }

  function rootOfSession(id: string): string | null {
    for (const [root, list] of Object.entries(
      localRef.current.sessionsByRoot,
    )) {
      if (list.some((s) => s.id === id)) return root;
    }
    return null;
  }

  async function onKill(): Promise<void> {
    const sessions = useSessionsStore.getState();
    const root = useWorkspaceStore.getState().root;
    if (!sessions.activeId || !root) return;
    await sessions.killWorker(sessions.activeId, root);
  }

  async function onRestart(): Promise<void> {
    const sessions = useSessionsStore.getState();
    const root = useWorkspaceStore.getState().root;
    if (!sessions.activeId || !root) return;
    await sessions.restartWorker(sessions.activeId, root);
  }

  function confirmDeleteSession(root: string, sessionId: string): void {
    const session = (sessionsByRoot[root] ?? []).find((s) => s.id === sessionId);
    const label = sessionLabel(session ?? { id: sessionId });
    let d: DialogHandle;
    d = dialog.warning({
      title: t.deleteSession,
      content: t.deleteConfirm(label),
      positiveText: t.delete,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            if (useWorkspaceStore.getState().root !== root) {
              await useWorkspaceStore.getState().openWorkspacePath(root);
            }
            await useSessionsStore.getState().deleteSession(sessionId, root);
            useChatStore.getState().clearSession(sessionId);
            useSendQueueStore.getState().clearSession(sessionId);
            const nextPins = {
              ...localRef.current.pins,
              [root]: (localRef.current.pins[root] ?? []).filter(
                (id) => id !== sessionId,
              ),
            };
            setPins(nextPins);
            persistPins(nextPins);
            const list = await loadSessions(root);
            await ensureActiveSession(root, true, list);
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          }
          return undefined;
        })();
      },
    });
  }

  function openRename(root: string, sessionId: string): void {
    const session = (sessionsByRoot[root] ?? []).find((s) => s.id === sessionId);
    setRenameTarget({ root, id: sessionId });
    setRenameDraft(sessionLabel(session ?? { id: sessionId }));
    setRenameOpen(true);
  }

  async function submitRename(): Promise<void> {
    const target = renameTarget;
    const name = renameDraft.trim();
    if (!target || !name) return;
    try {
      await useSessionsStore
        .getState()
        .renameSession(target.id, target.root, name);
      await loadSessions(target.root);
      setRenameOpen(false);
      message.success(t.renamed);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function openWorkspaceRename(root: string): void {
    setWsRenameRoot(root);
    setWsRenameDraft(workspaceName(root));
    setWsRenameOpen(true);
  }

  async function submitWorkspaceRename(): Promise<void> {
    const root = wsRenameRoot;
    if (!root) return;
    try {
      // 清空输入即恢复成文件夹名
      await useWorkspaceStore
        .getState()
        .renameWorkspace(root, wsRenameDraft.trim() || null);
      setWsRenameOpen(false);
      message.success(t.renamed);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function enterSelectMode(): void {
    setSelectMode(true);
    setSelectedSessionIds([]);
    setSelectAnchorId(null);
  }

  function exitSelectMode(): void {
    setSelectMode(false);
    setSelectedSessionIds([]);
    setSelectAnchorId(null);
  }

  function isSessionSelected(id: string): boolean {
    return selectedSessionIds.includes(id);
  }

  function toggleSessionSelect(id: string): void {
    const next = new Set(selectedSessionIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSessionIds([...next]);
    setSelectAnchorId(id);
  }

  /** Shift 点击：选中锚点到当前项之间的全部会话（含两端）。 */
  function onSessionRowClick(id: string, shiftKey: boolean): void {
    const anchor = selectAnchorId;
    const ids = visibleSessionIds;
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (!shiftKey || from < 0 || to < 0) {
      toggleSessionSelect(id);
      return;
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    setSelectedSessionIds(ids.slice(start, end + 1));
  }

  /** 归档勾选的会话（不按时间过滤）。 */
  async function archiveSelectedSessions(): Promise<void> {
    const targets = selectedSessionIds.filter((id) => !archivedIds.has(id));
    if (!targets.length) {
      message.info(t.archiveNone);
      return;
    }
    try {
      await useWorkspaceStore
        .getState()
        .setArchivedSessions([...archivedIds, ...targets]);
      message.success(t.archiveDone(targets.length));
      exitSelectMode();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }


  /** 选择模式下的按键：Del 等同点击工具条「删除」（仍走确认框），Esc 等同点击「取消」退出。 */
  function onSelectModeKeydown(event: KeyboardEvent): void {
    if (!localRef.current.selectMode) return;
    if (useKeybindingsStore.getState().capturing) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (isTextEntryTarget(event.target) || hasOpenModalMask()) return;
    if (event.key === "Escape" && !event.shiftKey) {
      event.preventDefault();
      exitSelectMode();
      return;
    }
    if (event.key === "Delete" && localRef.current.selectedSessionIds.length) {
      event.preventDefault();
      deleteSelectedSessions();
    }
  }

  function deleteSelectedSessions(): void {
    const ids = [...localRef.current.selectedSessionIds];
    if (!ids.length) return;
    let d: DialogHandle;
    d = dialog.warning({
      title: t.delete,
      content: t.deleteSelectedConfirm(ids.length),
      positiveText: t.delete,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            const touched = new Set<string>();
            const nextPins = { ...localRef.current.pins };
            for (const id of ids) {
              const root = rootOfSession(id);
              if (!root) continue;
              await useSessionsStore.getState().deleteSession(id, root);
              useChatStore.getState().clearSession(id);
              useSendQueueStore.getState().clearSession(id);
              nextPins[root] = (nextPins[root] ?? []).filter(
                (pid) => pid !== id,
              );
              touched.add(root);
            }
            setPins(nextPins);
            persistPins(nextPins);
            const archivedNext = useWorkspaceStore
              .getState()
              .archivedSessions.filter((entry) => !ids.includes(entry));
            if (
              archivedNext.length !==
              useWorkspaceStore.getState().archivedSessions.length
            ) {
              await useWorkspaceStore.getState().setArchivedSessions(archivedNext);
            }
            const loaded = new Map<string, SessionSummary[]>();
            for (const root of touched) {
              loaded.set(root, await loadSessions(root));
            }
            const currentRoot = useWorkspaceStore.getState().root;
            if (currentRoot) {
              await ensureActiveSession(
                currentRoot,
                true,
                loaded.get(currentRoot),
              );
            }
            exitSelectMode();
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          }
          return undefined;
        })();
      },
    });
  }

  /** Purge Pi config + sessions for a workspace (keeps project folder). */
  async function purgeWorkspaceUi(root: string): Promise<void> {
    const sessionIds = (sessionsByRoot[root] ?? []).map((s) => s.id);
    await useWorkspaceStore.getState().purgeWorkspace(root);
    for (const id of sessionIds) {
      useChatStore.getState().clearSession(id);
      useSendQueueStore.getState().clearSession(id);
    }
    setSessionsByRoot((prev) => {
      const next = { ...prev };
      delete next[root];
      return next;
    });
    setExpanded((prev) => {
      const next = { ...prev };
      delete next[root];
      return next;
    });
    const nextPins = { ...pins };
    delete nextPins[root];
    setPins(nextPins);
    persistPins(nextPins);
    const currentRoot = useWorkspaceStore.getState().root;
    if (currentRoot) {
      setExpanded((prev) => ({ ...prev, [currentRoot]: true }));
      const list = await loadSessions(currentRoot);
      await ensureActiveSession(currentRoot, true, list);
    } else {
      useSessionsStore.setState((s) => ({
        ...s,
        activeId: null,
        activeContextUsage: null,
      }));
    }
  }

  function confirmPurgeWorkspace(root: string): void {
    let d: DialogHandle;
    d = dialog.warning({
      title: t.removeWorkspaceTitle,
      content: t.removeWorkspaceConfirm(workspaceName(root)),
      positiveText: t.remove,
      negativeText: t.cancel,
      onPositiveClick: () => {
        d.loading = true;
        return (async () => {
          try {
            await purgeWorkspaceUi(root);
          } catch (err) {
            message.error(err instanceof Error ? err.message : String(err));
            d.loading = false;
            return false;
          }
          return undefined;
        })();
      },
    });
  }

  function updateView(patch: Partial<SessionView>): void {
    setView((prev) => {
      const next = { ...prev, ...patch };
      prefs.setItem(SESSION_VIEW_KEY, JSON.stringify(next));
      return next;
    });
  }

  /** 按任务显示：跨项目拍平成一条列表，每行标注所属项目。 */
  function flatTaskRows(): { root: string; item: VisibleSessionItem }[] {
    const rows = workspacePaths.flatMap((root) =>
      visibleSessions(root).map((session) => ({
        root,
        item: {
          session,
          depth: 0,
          lastFlags: [],
          parentId: undefined,
          hasChildren: false,
          childCount: 0,
          topId: null,
          guideFull: [],
          isLastSibling: true,
        },
      })),
    );
    const pinIndex = (row: { root: string; item: VisibleSessionItem }): number =>
      (pins[row.root] ?? []).indexOf(row.item.session.id);
    return rows.sort((a, b) => {
      const ap = pinIndex(a);
      const bp = pinIndex(b);
      if ((ap >= 0) !== (bp >= 0)) return ap >= 0 ? -1 : 1;
      if (ap >= 0 && ap !== bp) return ap - bp;
      if (view.sort === "recent") {
        const ar = isRunning(a.item.session.status) ? 0 : 1;
        const br = isRunning(b.item.session.status) ? 0 : 1;
        if (ar !== br) return ar - br;
      }
      const aRank = sessionRankOf(
        a.item.session,
        sessionRanks[a.root],
        view.sort,
      );
      const bRank = sessionRankOf(
        b.item.session,
        sessionRanks[b.root],
        view.sort,
      );
      if (aRank !== bRank) return bRank - aRank;
      return a.item.session.id.localeCompare(b.item.session.id);
    });
  }

  function renderSessionRow(
    root: string,
    item: VisibleSessionItem,
    sIdx: number,
    projectName?: string,
  ): ReactNode {
    const sessionId = item.session.id;
    return (
      <SessionRow
        key={sessionId}
        root={root}
        item={item}
        sIdx={sIdx}
        projectName={projectName}
        label={sessionLabel(item.session)}
        pinned={isPinned(root, sessionId)}
        pendingAsk={hasPendingAsk(sessionId)}
        justEnded={justEnded.has(sessionId)}
        selected={selectedSessionId === sessionId}
        guidesVisible={guidesVisibleFor(root, item)}
        selectMode={selectMode}
        sessionSelected={isSessionSelected(sessionId)}
        collapsedNode={isTreeNodeCollapsed(root, sessionId)}
        onSelect={(e) =>
          selectMode
            ? onSessionRowClick(sessionId, e.shiftKey)
            : void onSelectSession(root, sessionId)
        }
        onContextMenu={(e) => openSessionCtx(e, root, item.session)}
        onEnter={() => onSessionRowEnter(root, item)}
        onLeave={() => onSessionRowLeave(root)}
        onToggleNode={() => toggleTreeNode(root, sessionId)}
        onDelete={() => confirmDeleteSession(root, sessionId)}
        onToggleSelect={() => toggleSessionSelect(sessionId)}
      />
    );
  }

  function toggleSessionListExpanded(root: string): void {
    setSessionListExpanded((prev) => ({ ...prev, [root]: !prev[root] }));
  }

  /** 其他组件（如派生对话）建出的会话：置顶显示，折叠状态下也能看到。 */
  function onSessionCreated(event: Event): void {
    const detail = (
      event as CustomEvent<{ root?: unknown; sessionId?: unknown }>
    ).detail;
    const root = typeof detail?.root === "string" ? detail.root : "";
    const sessionId = typeof detail?.sessionId === "string" ? detail.sessionId : "";
    if (!root || !sessionId) return;
    bumpSessionsToFront(root, [sessionId]);
  }

  function moreMenuItems(): MenuItem[] {
    const activeStyle = (active: boolean): CSSProperties | undefined =>
      active ? { backgroundColor: "var(--bg-selected)", fontWeight: 600 } : undefined;
    return [
      { label: t.selectSessions, key: "select-mode", icon: <ListOutline /> },
      { type: "divider", key: "d-view-0" },
      {
        type: "group",
        key: "view-group",
        label: t.sessionViewGroup,
        children: [
          {
            key: "group:project",
            label: t.sessionViewGroupProject,
            style: activeStyle(view.group === "project"),
          },
          {
            key: "group:task",
            label: t.sessionViewGroupTask,
            style: activeStyle(view.group === "task"),
          },
        ],
      },
      {
        type: "group",
        key: "view-time",
        label: t.sessionViewTime,
        children: [
          {
            key: "time:all",
            label: t.sessionViewTimeAll,
            style: activeStyle(view.time === "all"),
          },
          {
            key: "time:1d",
            label: t.sessionViewTime1d,
            style: activeStyle(view.time === "1d"),
          },
          {
            key: "time:3d",
            label: t.sessionViewTime3d,
            style: activeStyle(view.time === "3d"),
          },
          {
            key: "time:7d",
            label: t.sessionViewTime7d,
            style: activeStyle(view.time === "7d"),
          },
        ],
      },
      {
        type: "group",
        key: "view-sort",
        label: t.sessionViewSort,
        children: [
          {
            key: "sort:recent",
            label: t.sessionViewSortRecent,
            style: activeStyle(view.sort === "recent"),
          },
          {
            key: "sort:created",
            label: t.sessionViewSortCreated,
            style: activeStyle(view.sort === "created"),
          },
        ],
      },
      { type: "divider", key: "d-view-1" },
      { key: "view-reset", label: t.sessionViewReset, icon: <RefreshOutline size={14} /> },
    ];
  }

  async function onMoreMenuSelect(key: string | number): Promise<void> {
    const k = String(key);
    if (k === "select-mode") {
      enterSelectMode();
      return;
    }
    if (k === "view-reset") {
      updateView(DEFAULT_SESSION_VIEW);
      return;
    }
    const [kind, value] = k.split(":");
    if (kind === "group") updateView({ group: value as SessionViewGroup });
    else if (kind === "time") updateView({ time: value as SessionViewTime });
    else if (kind === "sort") updateView({ sort: value as SessionViewSort });
  }

  function workspaceMenuItems(): MenuItem[] {
    return [
      {
        label: t.newSessionAction,
        key: "new-session",
        icon: <ChatboxOutline />,
      },
      {
        label: t.revealInExplorer,
        key: "reveal",
        icon: <FolderOpenOutline />,
      },
      {
        label: t.copyPath,
        key: "copy",
        icon: <CopyOutline />,
      },
      {
        label: t.relocateWorkspace,
        key: "relocate",
        icon: <FolderOutline />,
      },
      {
        label: t.renameProject,
        key: "rename-project",
        icon: <CreateOutline />,
      },
      { type: "divider", key: "d1" },
      {
        label: t.removeFromList,
        key: "remove",
        icon: <TrashOutline />,
      },
    ];
  }

  async function onWorkspaceMenu(
    root: string,
    key: string | number,
  ): Promise<void> {
    closeCtx();
    const k = String(key);
    switch (k) {
      case "new-session": {
        if (useWorkspaceStore.getState().root !== root) {
          await useWorkspaceStore.getState().openWorkspacePath(root);
        }
        if (!useWorkspaceStore.getState().sessionsReady) return;
        setExpanded((prev) => ({ ...prev, [root]: true }));
        useSessionsStore.getState().beginDraft(root);
        break;
      }
      case "reveal":
        await useWorkspaceStore.getState().revealInFolder(root);
        break;
      case "copy":
        await navigator.clipboard.writeText(root);
        message.success(t.pathCopied);
        break;
      case "relocate":
        await useWorkspaceStore.getState().relocateWorkspace(root);
        break;
      case "rename-project":
        openWorkspaceRename(root);
        break;
      case "remove": {
        confirmPurgeWorkspace(root);
        break;
      }
    }
  }

  function sessionMenu(root: string, session: SessionSummary): MenuItem[] {
    const pinned = isPinned(root, session.id);
    return [
      { label: t.open, key: "open" },
      { label: t.filesRename, key: "rename" },
      { label: pinned ? t.unpin : t.pin, key: "pin" },
      { label: t.copySessionId, key: "copy-id" },
      { type: "divider", key: "d1" },
      { label: t.delete, key: "delete" },
    ];
  }

  async function onSessionMenu(
    root: string,
    session: SessionSummary,
    key: string | number,
  ): Promise<void> {
    closeCtx();
    switch (String(key)) {
      case "open":
        await onSelectSession(root, session.id);
        break;
      case "rename":
        openRename(root, session.id);
        break;
      case "pin":
        togglePin(root, session.id);
        break;
      case "copy-id":
        await navigator.clipboard.writeText(session.id);
        message.success(t.sessionIdCopied);
        break;
      case "delete":
        confirmDeleteSession(root, session.id);
        break;
      default:
        break;
    }
  }

  const ctxItems = ((): MenuItem[] => {
    if (ctx.kind === "workspace") return workspaceMenuItems();
    if (ctx.session) return sessionMenu(ctx.root, ctx.session);
    return [];
  })();

  function closeCtx(): void {
    setCtx((prev) => (prev.show ? { ...prev, show: false } : prev));
  }

  function openWorkspaceCtx(e: ReactMouseEvent, root: string): void {
    e.preventDefault();
    e.stopPropagation();
    setCtx({
      show: true,
      x: e.clientX,
      y: e.clientY,
      placement: "bottomLeft",
      kind: "workspace",
      root,
      session: null,
    });
  }

  /**
   * 省略号按钮：菜单已开则关闭，否则贴着按钮打开。
   * 菜单右对齐按钮右缘（不伸到侧栏外面），下方放得下就挂在按钮下沿，
   * 放不下才翻到上沿；两种情况都不压住按钮，否则再点一次就点到菜单上去了。
   */
  function onWorkspaceMore(e: ReactMouseEvent, root: string): void {
    e.preventDefault();
    e.stopPropagation();
    const anchor = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fitsBelow = window.innerHeight - anchor.bottom >= CTX_MENU_HEIGHT;
    setCtx((prev) => {
      if (prev.show && prev.kind === "workspace" && prev.root === root) {
        return { ...prev, show: false };
      }
      return {
        show: true,
        x: anchor.right,
        y: fitsBelow ? anchor.bottom : anchor.top,
        placement: fitsBelow ? "bottomRight" : "topRight",
        kind: "workspace",
        root,
        session: null,
      };
    });
  }

  function openSessionCtx(
    e: ReactMouseEvent,
    root: string,
    session: SessionSummary,
  ): void {
    e.preventDefault();
    e.stopPropagation();
    setCtx({
      show: true,
      x: e.clientX,
      y: e.clientY,
      placement: "bottomLeft",
      kind: "session",
      root,
      session,
    });
  }

  async function onCtxSelect(key: string | number): Promise<void> {
    if (ctx.kind === "workspace") {
      await onWorkspaceMenu(ctx.root, key);
      return;
    }
    if (ctx.session) {
      await onSessionMenu(ctx.root, ctx.session, key);
    }
  }

  useEffect(() => {
    markRendererStartup("renderer:sidebar-mounted");
    const keybindings = useKeybindingsStore.getState();
    keybindings.register("new-session", () => void onNewAgent());
    keybindings.register("select-sessions", enterSelectMode);
    const offNotifyOpen = window.api.notify.onOpenSession(
      ({ sessionId, cwd }) => {
        void onNotifyOpenSession(sessionId, cwd);
      },
    );
    loadPins();
    loadSessionRanks();
    // 另一窗口改了排序/置顶/分组时跟着变，各窗口保持一致。
    const offPrefs = registerStateApplier((change) => {
      if (change.scope !== "prefs") return;
      const keys = change.keys ?? [];
      if (keys.includes(PIN_KEY)) loadPins();
      if (keys.includes(SESSION_RANK_KEY)) loadSessionRanks();
      if (keys.includes(SESSION_VIEW_KEY)) setView(loadSessionView());
    });
    // 派生会话等由其他组件新建的会话：排到最前，避免被折叠到「展开其余 N 个」之下。
    window.addEventListener("pi-session-created", onSessionCreated);
    window.addEventListener("keydown", onSelectModeKeydown, true);
    // App.vue already loads workspace/recent — skip duplicate IPC on cold start.
    const boot: Promise<unknown>[] = [
      useWorkspaceStore.getState().refreshAliases(),
      useWorkspaceStore.getState().refreshArchivedSessions(),
    ];
    if (!useWorkspaceStore.getState().root) {
      boot.push(useWorkspaceStore.getState().getWorkspace());
    }
    if (!useWorkspaceStore.getState().recent.length) {
      boot.push(useWorkspaceStore.getState().listRecentFast());
    }
    void (async () => {
      await Promise.all(boot);
      const root = useWorkspaceStore.getState().root;
      if (root && useWorkspaceStore.getState().sessionsReady) {
        let list: SessionSummary[] = [];
        try {
          list = await loadSessions(root);
        } finally {
          setExpanded((prev) => ({ ...prev, [root]: true }));
        }
        await ensureActiveSession(root, true, list);
      }
      bindWorkspaceSortable();
    })();

    return () => {
      useKeybindingsStore.getState().unregister("new-session");
      useKeybindingsStore.getState().unregister("select-sessions");
      offNotifyOpen();
      offPrefs();
      window.removeEventListener("pi-session-created", onSessionCreated);
      window.removeEventListener("keydown", onSelectModeKeydown, true);
      destroySortables();
    };
  }, []);


  useEffect(() => {
    const root = workspace.root;
    const ready = workspace.sessionsReady;
    if (!root || !ready) return;
    void (async () => {
      let list: SessionSummary[] = [];
      try {
        // 先加载再展开，避免展开瞬间露出空列表或上一工作区的会话
        list = await loadSessions(root);
      } finally {
        setExpanded((prev) => ({ ...prev, [root]: true }));
      }
      const skipRoot = skipAutoSelectRoot.current;
      skipAutoSelectRoot.current = null;
      await ensureActiveSession(
        root,
        !(skipRoot && sameWorkspacePath(skipRoot, root)),
        list,
      );
    })();
  }, [workspace.root, workspace.sessionsReady]);

  useEffect(() => {
    const root = useWorkspaceStore.getState().root;
    if (!root) return;
    // 切换间隙 store 仍是上一工作区的列表，跳过合并以免污染本工作区的缓存
    if (useSessionsStore.getState().listRoot !== root) return;
    const list = useSessionsStore.getState().sessions;
    const byId = new Map(list.map((s) => [s.id, s]));
    const current = localRef.current.sessionsByRoot[root] ?? [];
    if (!current.length) {
      setSessionsByRoot((prev) => ({
        ...prev,
        [root]: list.map((s) => ({ ...s })),
      }));
      return;
    }
    // Drop rows the live store no longer knows (deleted elsewhere) — but keep
    // them while the store list is empty (root not loaded yet).
    const alive = current.filter((row) => list.length === 0 || byId.has(row.id));
    const touched: string[] = [];
    // Update existing rows + append any new ones from the store
    const next = alive.map((row) => {
      const live = byId.get(row.id);
      if (!live) return row;
      if (live.modified > row.modified) touched.push(row.id);
      return {
        ...row,
        ...live,
        name: live.name ?? row.name,
        firstMessage: live.firstMessage ?? row.firstMessage,
        status: live.status,
      };
    });
    for (const live of list) {
      if (!next.some((r) => r.id === live.id)) next.push({ ...live });
    }
    setSessionsByRoot((prev) => ({ ...prev, [root]: next }));
    if (touched.length) {
      // 运行中的会话开始时已经置顶，运行期间的活动不再改顺序
      const moved = touched
        .filter((id) => !isRunning(byId.get(id)?.status ?? "idle"))
        .sort((a, b) =>
          (byId.get(b)?.modified ?? "").localeCompare(
            byId.get(a)?.modified ?? "",
          ),
        );
      if (moved.length) bumpSessionsToFront(root, moved);
    }
  }, [sessionsStore.sessions]);

  useEffect(() => {
    const rows = sessionsStore.sessions;
    const ended: string[] = [];
    // 开始运行与运行结束都算一次「把会话抬到最前」，同一批按最近活动时间排序，
    // 否则两个同时运行的任务会按遍历顺序互相抢位。
    const bumpedByRoot = new Map<string, string[]>();
    for (const [id, status] of Object.entries(statusBySession)) {
      const was = prevStatuses.current.get(id);
      if (!was || was === status) continue;
      if (isRunning(was) === isRunning(status)) continue;
      const root = rootOfSession(id);
      if (!root) continue;
      bumpedByRoot.set(root, [...(bumpedByRoot.get(root) ?? []), id]);
    }
    for (const row of rows) {
      const was = prevStatuses.current.get(row.id);
      if (!was || was === "idle" || row.status !== "idle") continue;
      if (row.id !== useSessionsStore.getState().activeId) ended.push(row.id);
    }
    prevStatuses.current = new Map(Object.entries(statusBySession));
    const modifiedOf = (id: string): string => {
      for (const list of Object.values(localRef.current.sessionsByRoot)) {
        const row = list.find((item) => item.id === id);
        if (row) return row.modified;
      }
      return "";
    };
    for (const [root, ids] of bumpedByRoot) {
      bumpSessionsToFront(
        root,
        ids.sort((a, b) => modifiedOf(b).localeCompare(modifiedOf(a))),
      );
    }
    if (!ended.length) return;
    setJustEnded((prev) => {
      const next = new Set(prev);
      for (const id of ended) next.add(id);
      return next;
    });
  }, [sessionsStore.sessions, statusBySession]);

  useEffect(() => {
    const id = sessionsStore.activeId;
    if (!id) return;
    setJustEnded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, [sessionsStore.activeId]);


  useEffect(() => {
    if (!ctx.show) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      // 左键点在菜单上：留给菜单项自己处理（先关掉会把这次点击吞掉）。
      if (event.button === 0 && target?.closest?.(".ant-dropdown")) return;
      // 省略号按钮自己管开关，按在按钮上的这一下不能把菜单关掉。
      if (target?.closest?.("[data-ws-more-trigger]")) return;
      // 其余情况（含右键）一律先关掉菜单：菜单一旦消失，随后的 contextmenu 就会
      // 落到被它盖住的会话行上，菜单才能跟着切换到新的目标。
      closeCtx();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [ctx.show]);

  const taskRows = view.group === "task" ? flatTaskRows() : [];
  const listedRoots =
    view.time === "all"
      ? workspacePaths
      : workspacePaths.filter((root) => sessionsFor(root).length > 0);


  return {
    t,
    activeBackend,
    switchBackend,
    onNewAgent,
    showStuckRecovery,
    onKill,
    onRestart,
    workspaceCollapsed,
    setWorkspaceCollapsed,
    view,
    moreMenuItems,
    onMoreMenuSelect,
    onAddWorkspace,
    taskRows,
    renderSessionRow,
    workspaceName,
    listedRoots,
    visibleTreeItemsFor,
    sessionsFor,
    expanded,
    onWorkspaceClick,
    openWorkspaceCtx,
    onNewAgentForWorkspace,
    onWorkspaceMore,
    workspace,
    sessionsStore,
    workspacePaths,
    workspaceTreeEl,
    sessionListExpanded,
    selectMode,
    sessionListRef,
    hiddenSessionCount,
    toggleSessionListExpanded,
    collapsibleSessionCount,
    exitSelectMode,
    selectedSessionIds,
    archiveSelectedSessions,
    deleteSelectedSessions,
    openArchivedList,
    renameOpen,
    submitRename,
    setRenameOpen,
    renameDraft,
    setRenameDraft,
    wsRenameOpen,
    submitWorkspaceRename,
    setWsRenameOpen,
    wsRenameDraft,
    setWsRenameDraft,
    archivedOpen,
    setArchivedOpen,
    archivedFilteredRows,
    archivedQuery,
    setArchivedQuery,
    archivedSelected,
    onArchivedRowClick,
    toggleArchivedSelect,
    restoreSelectedArchived,
    deleteSelectedArchived,
    ctx,
    ctxItems,
    onCtxSelect,
  };
}
