import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Alert,
  Button,
  Checkbox,
  Dropdown,
  Input,
  Modal,
  Space,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import {
  ArchiveOutline,
  ChatboxOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  ContractOutline,
  CopyOutline,
  CreateOutline,
  EllipsisHorizontalOutline,
  FolderOpenOutline,
  FolderOutline,
  ListOutline,
  PinOutline,
  TrashOutline,
} from "@renderer/components/icons/ionicons";
import CodiconIcon, {
  type CodiconName,
} from "@renderer/components/icons/CodiconIcon";
import GitPullRequestIcon from "@renderer/components/icons/GitPullRequestIcon";
import Sortable from "sortablejs";
import type { SessionStatus, SessionSummary } from "../../../shared/protocol";
import { SESSION_HISTORY_INITIAL_LIMIT } from "../../../shared/protocol";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { useChatStore } from "@renderer/stores/chat";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useWorkspaceStore, type WorkspaceState } from "@renderer/stores/workspace";
import { useLayoutStore } from "@renderer/stores/layout";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { isUnstartedSession } from "@renderer/utils/session-started";
import { isTextEntryTarget } from "@renderer/utils/keyboard-target";
import { buildSessionTree, type SessionTreeItem } from "@renderer/utils/session-tree";
import { markRendererStartup } from "@renderer/utils/startup-timing";
import * as prefs from "@renderer/utils/prefs";
import { useI18n } from "@renderer/i18n/use-i18n";
import { useDialog, useMessage, type DialogHandle } from "@renderer/services/feedback";
import styles from "./SessionSidebar.module.css";

const PIN_KEY = "session-pins:v1";
const SESSION_ORDER_KEY = "pi-desktop:session-order:v2";
const SESSION_VISIBLE_LIMIT = 5;

const ARCHIVE_KEY_PREFIX = "archive:";
const ARCHIVE_DAY_STEPS = [3, 7, 30, 90];

type MenuItem = NonNullable<MenuProps["items"]>[number];

type ArchivedRow = {
  id: string;
  label: string;
  workspace: string;
  modified: string;
};

type ContextMenuState = {
  show: boolean;
  x: number;
  y: number;
  kind: "workspace" | "session";
  root: string;
  session: SessionSummary | null;
};

type VisibleSessionItem = SessionTreeItem & {
  /** 所属顶层会话 id：悬停任一层级时整组显示导线。 */
  topId: string | null;
  /** 每个祖先层级：竖线是否贯穿整行（末级否则画弯头，中间级否则不画）。 */
  guideFull: boolean[];
  /** 是否为父级的最后一个子会话（末级导线以圆角弯头收尾）。 */
  isLastSibling: boolean;
};

type SidebarLocal = {
  sessionsByRoot: Record<string, SessionSummary[]>;
  sessionOrders: Record<string, string[]>;
  pins: Record<string, string[]>;
  sessionListExpanded: Record<string, boolean>;
  selectMode: boolean;
  selectedSessionIds: string[];
  workspacePaths: string[];
};

/** 侧栏展示的工作区：最近列表 + 活动工作区兜底。 */
function workspacePathsOf(workspace: WorkspaceState): string[] {
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

function isRunning(status: SessionStatus): boolean {
  return status === "running";
}

function sameWorkspacePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

function relativeTime(iso: string): string {
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
function visibleSessionsOfList(
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

function compareSessionsOf(
  sessionOrders: Record<string, string[]>,
  pins: Record<string, string[]>,
  root: string,
): (a: SessionSummary, b: SessionSummary) => number {
  const order = sessionOrders[root];
  const orderMap = order?.length ? new Map(order.map((id, i) => [id, i])) : null;
  const pinned = new Set(pins[root] ?? []);
  return (a, b) => {
    if (orderMap) {
      const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return b.modified.localeCompare(a.modified);
    }
    const ap = pinned.has(a.id) ? 0 : 1;
    const bp = pinned.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.modified.localeCompare(a.modified);
  };
}

function topSessionsOf(
  list: SessionSummary[],
  archivedIds: Set<string>,
  compare: (a: SessionSummary, b: SessionSummary) => number,
): SessionSummary[] {
  return buildSessionTree(visibleSessionsOfList(list, archivedIds), compare)
    .filter((item) => item.depth === 0)
    .map((item) => item.session);
}

function hasOpenModalMask(): boolean {
  return (
    document.querySelector(".ant-modal-mask") !== null ||
    document.querySelector(".ant-drawer-mask") !== null
  );
}

export function SessionSidebar(): ReactNode {
  const t = useI18n();
  const dialog = useDialog();
  const message = useMessage();

  const sessionsStore = useSessionsStore();
  const workspace = useWorkspaceStore();
  const layout = useLayoutStore();
  const appearance = useAppearanceStore();

  const pendingAskKey = useChatStore((s) => {
    const ids: string[] = [];
    for (const [id, state] of Object.entries(s.bySession)) {
      if (state.pendingAskUser || state.pendingExtensionUi) ids.push(id);
    }
    return ids.sort().join(",");
  });

  const activeSession = useMemo(
    () =>
      sessionsStore.activeId
        ? (sessionsStore.sessions.find((s) => s.id === sessionsStore.activeId) ??
          null)
        : null,
    [sessionsStore.activeId, sessionsStore.sessions],
  );
  const showStuckRecovery = activeSession?.status === "stuck";

  const [sessionsByRoot, setSessionsByRoot] = useState<
    Record<string, SessionSummary[]>
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pins, setPins] = useState<Record<string, string[]>>({});
  const [sessionOrders, setSessionOrders] = useState<Record<string, string[]>>(
    {},
  );
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

  const [selectMode, setSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [selectAnchorId, setSelectAnchorId] = useState<string | null>(null);

  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedRows, setArchivedRows] = useState<ArchivedRow[]>([]);
  const [archivedQuery, setArchivedQuery] = useState("");
  const [archivedSelected, setArchivedSelected] = useState<string[]>([]);
  const [archivedAnchorId, setArchivedAnchorId] = useState<string | null>(null);

  const [ctx, setCtx] = useState<ContextMenuState>({
    show: false,
    x: 0,
    y: 0,
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

  const localRef = useRef<SidebarLocal>({
    sessionsByRoot,
    sessionOrders,
    pins,
    sessionListExpanded,
    selectMode,
    selectedSessionIds,
    workspacePaths,
  });

  useEffect(() => {
    localRef.current = {
      sessionsByRoot,
      sessionOrders,
      pins,
      sessionListExpanded,
      selectMode,
      selectedSessionIds,
      workspacePaths,
    };
  });

  const sessionListEls = useRef(new Map<string, HTMLElement>());
  const sessionSortables = useRef(new Map<string, Sortable>());
  const sessionListRefCallbacks = useRef(
    new Map<string, (el: Element | null) => void>(),
  );
  const workspaceTreeEl = useRef<HTMLDivElement | null>(null);
  const workspaceSortable = useRef<Sortable | null>(null);
  const prevStatuses = useRef(new Map<string, SessionStatus>());
  const skipAutoSelectRoot = useRef<string | null>(null);

  const customizeEntries = useMemo(
    () =>
      [
        {
          name: "settings" as CodiconName,
          section: "general",
          label: t.customizeSettings,
        },
      ],
    [t],
  );

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

  function persistSessionOrders(next: Record<string, string[]>): void {
    prefs.setItem(SESSION_ORDER_KEY, JSON.stringify(next));
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

  function loadSessionOrders(): void {
    try {
      const raw = prefs.getItem(SESSION_ORDER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(parsed)) {
        next[k] = Array.isArray(v) ? v : [];
      }
      setSessionOrders(next);
    } catch {
      // ignore
    }
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
    return compareSessionsOf(sessionOrders, pins, root);
  }

  function visibleSessions(root: string): SessionSummary[] {
    return visibleSessionsOfList(
      [...(sessionsByRoot[root] ?? [])],
      archivedIds,
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
    return topSessionsOf(
      [...(sessionsByRoot[root] ?? [])],
      archivedIds,
      compareSessions(root),
    );
  }

  /** 侧栏可见会话的渲染顺序，Shift 范围选择按它取区间。 */
  const visibleSessionIds = ((): string[] => {
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
      topIdOfSession(root, sessionsStore.activeId) === item.topId
    );
  }

  function collapsibleSessionCount(root: string): number {
    return Math.max(0, sessionsFor(root).length - SESSION_VISIBLE_LIMIT);
  }

  function hiddenSessionCount(root: string): number {
    if (sessionListExpanded[root]) return 0;
    return collapsibleSessionCount(root);
  }

  async function loadSessions(root: string): Promise<SessionSummary[]> {
    markRendererStartup("renderer:sessions-request");
    const list = await window.api.sessions.list(root);
    setSessionsByRoot((prev) => ({ ...prev, [root]: list }));
    if (root === useWorkspaceStore.getState().root) {
      useSessionsStore.setState({ sessions: list, listRoot: root });
    }
    useSessionWidgetsStore
      .getState()
      .pruneStaleTodoSnapshots(new Set(list.map((s) => s.id)));
    markRendererStartup("renderer:ready");
    return list;
  }

  async function ensureSessionsLoaded(root: string): Promise<void> {
    if (localRef.current.sessionsByRoot[root]?.length) return;
    await loadSessions(root);
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
        localRef.current.sessionOrders,
        localRef.current.pins,
        root,
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
      const nextOrders = {
        ...localRef.current.sessionOrders,
        [root]: (localRef.current.sessionOrders[root] ?? []).filter(
          (id) => id !== sessionId,
        ),
      };
      setSessionOrders(nextOrders);
      persistSessionOrders(nextOrders);
      setSessionsByRoot((prev) => ({
        ...prev,
        [root]: (prev[root] ?? []).filter((s) => s.id !== sessionId),
      }));
    } catch (err) {
      console.error("discard unstarted session failed", err);
    }
  }

  async function onSelectSession(
    root: string,
    sessionId: string,
    loaded?: SessionSummary[],
  ): Promise<void> {
    useLayoutStore.getState().showChat();
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
      useChatStore
        .getState()
        .hydrateFromHistory(sessionId, page.messages, page.hasMore);
      if (discardLeaving && useWorkspaceStore.getState().root === root) {
        await discardUnstartedSession(leavingRoot, leaving!.id);
      }
    } catch (err) {
      console.error("select session failed", err);
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      useChatStore.getState().endHistoryLoad(sessionId);
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

  function archiveDaysFromKey(key: string): number | null {
    if (!key.startsWith(ARCHIVE_KEY_PREFIX)) return null;
    const days = Number(key.slice(ARCHIVE_KEY_PREFIX.length));
    return Number.isFinite(days) && days > 0 ? days : null;
  }

  async function onArchiveSelect(key: string | number): Promise<void> {
    const days = archiveDaysFromKey(String(key));
    if (days !== null) await archiveSessionsOlderThan(days);
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

  /** 归档当前分类下超过 N 天未活动的会话（菜单里的时间归档）。 */
  async function archiveSessionsOlderThan(days: number): Promise<void> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const targets: string[] = [];
    try {
      for (const root of workspacePaths) {
        await ensureSessionsLoaded(root);
        for (const s of localRef.current.sessionsByRoot[root] ?? []) {
          if (archivedIds.has(s.id)) continue;
          if (s.id === useSessionsStore.getState().activeId) continue;
          if (isRunning(s.status)) continue;
          if (new Date(s.modified).getTime() > cutoff) continue;
          targets.push(s.id);
        }
      }
      if (!targets.length) {
        message.info(t.archiveNone);
        return;
      }
      await useWorkspaceStore
        .getState()
        .setArchivedSessions([...archivedIds, ...targets]);
      message.success(t.archiveDone(targets.length));
      exitSelectMode();
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function openArchivedList(): Promise<void> {
    setArchivedOpen(true);
    setArchivedRows([]);
    try {
      for (const root of workspacePaths) await ensureSessionsLoaded(root);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return;
    }
    const byId = new Map<string, { root: string; session: SessionSummary }>();
    for (const root of workspacePaths) {
      for (const s of localRef.current.sessionsByRoot[root] ?? []) {
        byId.set(s.id, { root, session: s });
      }
    }
    setArchivedRows(
      useWorkspaceStore
        .getState()
        .archivedSessions.map((id) => {
          const hit = byId.get(id);
          return {
            id,
            label: hit ? sessionLabel(hit.session) : id,
            workspace: hit ? workspaceName(hit.root) : "",
            modified: hit?.session.modified ?? "",
          };
        }),
    );
  }

  const archivedFilteredRows = useMemo(() => {
    const q = archivedQuery.trim().toLowerCase();
    if (!q) return archivedRows;
    return archivedRows.filter(
      (row) =>
        row.label.toLowerCase().includes(q) ||
        row.workspace.toLowerCase().includes(q),
    );
  }, [archivedRows, archivedQuery]);

  function isArchivedSelected(id: string): boolean {
    return archivedSelected.includes(id);
  }

  function toggleArchivedSelect(id: string): void {
    const next = new Set(archivedSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setArchivedSelected([...next]);
    setArchivedAnchorId(id);
  }

  /** Shift 点击：选中锚点到当前项之间的全部归档项。 */
  function onArchivedRowClick(id: string, shiftKey: boolean): void {
    const anchor = archivedAnchorId;
    const ids = archivedFilteredRows.map((row) => row.id);
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (!shiftKey || from < 0 || to < 0) {
      toggleArchivedSelect(id);
      return;
    }
    const [start, end] = from <= to ? [from, to] : [to, from];
    setArchivedSelected(ids.slice(start, end + 1));
  }

  function dropArchivedRows(ids: string[]): void {
    setArchivedRows((prev) => prev.filter((row) => !ids.includes(row.id)));
    setArchivedSelected((prev) => prev.filter((id) => !ids.includes(id)));
  }

  async function restoreSelectedArchived(): Promise<void> {
    const ids = [...archivedSelected];
    if (!ids.length) return;
    try {
      await useWorkspaceStore
        .getState()
        .setArchivedSessions(
          useWorkspaceStore
            .getState()
            .archivedSessions.filter((entry) => !ids.includes(entry)),
        );
      dropArchivedRows(ids);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  }

  function deleteSelectedArchived(): void {
    const ids = [...archivedSelected];
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
            for (const id of ids) {
              const root = rootOfSession(id);
              if (!root) continue;
              await useSessionsStore.getState().deleteSession(id, root);
              useChatStore.getState().clearSession(id);
              useSendQueueStore.getState().clearSession(id);
              touched.add(root);
            }
            await useWorkspaceStore
              .getState()
              .setArchivedSessions(
                useWorkspaceStore
                  .getState()
                  .archivedSessions.filter((entry) => !ids.includes(entry)),
              );
            dropArchivedRows(ids);
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

  function collapseAllWorkspaces(): void {
    setExpanded((prev) => {
      const next: Record<string, boolean> = {};
      for (const key of Object.keys(prev)) next[key] = false;
      return next;
    });
  }

  function openCustomize(section: string): void {
    useLayoutStore.getState().openCustomize(section);
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

  function bindSessionSortable(root: string): void {
    const el = sessionListEls.current.get(root);
    if (!el) return;
    sessionSortables.current.get(root)?.destroy();
    const sortable = Sortable.create(el, {
      animation: 150,
      draggable: "[data-session-row]",
      filter: "[data-no-session-drag]",
      disabled:
        !localRef.current.sessionListExpanded[root] &&
        (localRef.current.sessionsByRoot[root]?.length ?? 0) >
          SESSION_VISIBLE_LIMIT,
      onEnd: () => {
        const ids = [
          ...el.querySelectorAll<HTMLElement>("[data-session-row][data-id]"),
        ]
          .map((n) => n.dataset.id)
          .filter((id): id is string => Boolean(id));
        if (!ids.length) return;
        const nextOrders = {
          ...localRef.current.sessionOrders,
          [root]: ids,
        };
        setSessionOrders(nextOrders);
        persistSessionOrders(nextOrders);
        // Keep pinned ids order in sync with visual order
        const pinned = new Set(localRef.current.pins[root] ?? []);
        if (pinned.size) {
          const nextPins = {
            ...localRef.current.pins,
            [root]: ids.filter((id) => pinned.has(id)),
          };
          setPins(nextPins);
          persistPins(nextPins);
        }
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

  function toggleSessionListExpanded(root: string): void {
    setSessionListExpanded((prev) => ({ ...prev, [root]: !prev[root] }));
  }

  /** Freeze current visual order and prepend a new session id at the front. */
  function appendSessionToOrder(root: string, sessionId: string): void {
    const local = localRef.current;
    const base = topSessionsOf(
      [...(local.sessionsByRoot[root] ?? [])],
      new Set(useWorkspaceStore.getState().archivedSessions),
      compareSessionsOf(local.sessionOrders, local.pins, root),
    )
      .map((s) => s.id)
      .filter((id) => id !== sessionId);
    const next = { ...local.sessionOrders, [root]: [sessionId, ...base] };
    setSessionOrders(next);
    persistSessionOrders(next);
  }

  /** 其他组件（如派生对话）建出的会话：置顶显示，折叠状态下也能看到。 */
  function onSessionCreated(event: Event): void {
    const detail = (
      event as CustomEvent<{ root?: unknown; sessionId?: unknown }>
    ).detail;
    const root = typeof detail?.root === "string" ? detail.root : "";
    const sessionId = typeof detail?.sessionId === "string" ? detail.sessionId : "";
    if (!root || !sessionId) return;
    appendSessionToOrder(root, sessionId);
  }

  function archiveDayOptions(): MenuItem[] {
    return ARCHIVE_DAY_STEPS.map((days) => ({
      label: t.archiveOlderThan(days),
      key: `${ARCHIVE_KEY_PREFIX}${days}`,
    }));
  }

  function moreMenuItems(): MenuItem[] {
    return [
      { label: t.selectSessions, key: "select-mode", icon: <ListOutline /> },
      {
        label: t.archiveMenu,
        key: "archive-menu",
        icon: <ArchiveOutline />,
        children: archiveDayOptions(),
      },
      {
        label: t.archivedSessions,
        key: "archived-list",
        icon: <ArchiveOutline />,
      },
    ];
  }

  async function onMoreMenuSelect(key: string | number): Promise<void> {
    const k = String(key);
    if (k === "select-mode") enterSelectMode();
    else if (k === "archived-list") await openArchivedList();
    else await onArchiveSelect(k);
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
      { label: t.clearContext, key: "clear-context" },
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
      case "clear-context":
        try {
          await onSelectSession(root, session.id);
          await window.api.sessions.clearContext(session.id, root);
          useChatStore.getState().clearSession(session.id);
          useChatStore.getState().hydrateFromHistory(session.id, []);
          await loadSessions(root);
          message.success(t.clearContextDone);
        } catch (err) {
          message.error(err instanceof Error ? err.message : String(err));
        }
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
      kind: "workspace",
      root,
      session: null,
    });
  }

  /** 省略号按钮打开工作区菜单：延后一拍，避免同一次点击冒泡到 document 被 clickoutside 立即关掉。 */
  function onWorkspaceMore(e: ReactMouseEvent, root: string): void {
    const { clientX, clientY } = e;
    window.setTimeout(() => {
      setCtx({
        show: true,
        x: clientX,
        y: clientY,
        kind: "workspace",
        root,
        session: null,
      });
    }, 0);
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
    loadSessionOrders();
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
      window.removeEventListener("pi-session-created", onSessionCreated);
      window.removeEventListener("keydown", onSelectModeKeydown, true);
      workspaceSortable.current?.destroy();
      workspaceSortable.current = null;
      for (const sortable of sessionSortables.current.values()) sortable.destroy();
      sessionSortables.current.clear();
      sessionListEls.current.clear();
    };
  }, []);

  useEffect(() => {
    bindWorkspaceSortable();
  }, [workspacePathsKey]);

  useEffect(() => {
    for (const root of workspacePaths) bindSessionSortable(root);
  }, [workspacePathsKey, sessionsByRoot, sessionListExpanded]);

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
    // Update existing rows + append any new ones from the store
    const next = alive.map((row) => {
      const live = byId.get(row.id);
      if (!live) return row;
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
  }, [sessionsStore.sessions]);

  useEffect(() => {
    const rows = sessionsStore.sessions;
    const ended: string[] = [];
    for (const row of rows) {
      const was = prevStatuses.current.get(row.id);
      if (!was || was === "idle" || row.status !== "idle") continue;
      if (row.id !== useSessionsStore.getState().activeId) ended.push(row.id);
    }
    prevStatuses.current = new Map(rows.map((row) => [row.id, row.status]));
    if (!ended.length) return;
    setJustEnded((prev) => {
      const next = new Set(prev);
      for (const id of ended) next.add(id);
      return next;
    });
  }, [sessionsStore.sessions]);

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
    if (archivedOpen) return;
    setArchivedQuery((prev) => (prev ? "" : prev));
    setArchivedSelected((prev) => (prev.length ? [] : prev));
    setArchivedAnchorId((prev) => prev ?? null);
  }, [archivedOpen]);

  useEffect(() => {
    if (!ctx.show) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.(".ant-dropdown")) return;
      closeCtx();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [ctx.show]);

  return (
    <aside className="sidebar">
      <div className={styles.topActions}>
        <Button
          type="text"
          size="small"
          className={`pi-interactive ${styles.topBtn}`}
          styles={{ root: { justifyContent: "flex-start" } }}
          onClick={() => void onNewAgent()}
        >
          <span className={styles.btnContent}>
            <ChatboxOutline size={15} />
            <span className={styles.btnLabel}>{t.newSessionAction}</span>
          </span>
        </Button>
        <Button
          type="text"
          size="small"
          className={`pi-interactive ${styles.topBtn}`}
          styles={{ root: { justifyContent: "flex-start" } }}
          onClick={() => void onAddWorkspace()}
        >
          <span className={styles.btnContent}>
            <FolderOpenOutline size={15} />
            <span className={styles.btnLabel}>{t.openWorkspace}</span>
          </span>
        </Button>
        {!selectMode ? (
          <Button
            type="text"
            size="small"
            className={`pi-interactive ${styles.topBtn} ${
              layout.centerView === "pull-requests" ? styles.topBtnActive : ""
            }`}
            styles={{ root: { justifyContent: "flex-start" } }}
            aria-current={
              layout.centerView === "pull-requests" ? "page" : undefined
            }
            onClick={() => useLayoutStore.getState().showPullRequests()}
          >
            <span className={styles.btnContent}>
              <span className={styles.btnGlyph}>
                <GitPullRequestIcon size={16} />
              </span>
              <span className={styles.btnLabel}>{t.pullRequests}</span>
            </span>
          </Button>
        ) : null}
      </div>

      {showStuckRecovery ? (
        <Alert
          type="warning"
          variant="filled"
          style={{ margin: "0 8px 8px" }}
          title={t.stuckBanner}
          description={
            <Space style={{ marginTop: 6 }}>
              <Button
                size="small"
                type="primary"
                danger
                onClick={() => void onKill()}
              >
                {t.terminate}
              </Button>
              <Button size="small" onClick={() => void onRestart()}>
                {t.restart}
              </Button>
            </Space>
          }
        />
      ) : null}

      <div className={styles.sessionsPane}>
        <div className={styles.wsTools}>
          {selectMode ? (
            <div className={styles.wsSelectActions}>
              <Button type="text" size="small" onClick={exitSelectMode}>
                {t.cancel}
              </Button>
              <Button
                type="text"
                size="small"
                disabled={!selectedSessionIds.length}
                onClick={() => void archiveSelectedSessions()}
              >
                {t.archiveMenu}
              </Button>
              <Button
                type="text"
                size="small"
                disabled={!selectedSessionIds.length}
                onClick={deleteSelectedSessions}
              >
                {t.delete}
              </Button>
            </div>
          ) : (
            <Button
              type="text"
              size="small"
              className={`pi-interactive ${styles.wsPanelToggle}`}
              styles={{ root: { justifyContent: "flex-start" } }}
              title={t.workspacePanelProjects}
              onClick={() => setWorkspaceCollapsed((prev) => !prev)}
            >
              <span className={styles.btnContent}>
                {workspaceCollapsed ? (
                  <ChevronForwardOutline size={14} />
                ) : (
                  <ChevronDownOutline size={14} />
                )}
                <span className={styles.wsPanelLabel}>
                  {t.workspacePanelProjects}
                </span>
              </span>
            </Button>
          )}
          <div className={styles.wsToolIcons}>
            <Button
              type="text"
              size="small"
              title={t.collapseAllWorkspaces}
              onClick={collapseAllWorkspaces}
            >
              <ContractOutline size={14} />
            </Button>
            <Dropdown
              trigger={["click"]}
              menu={{
                items: moreMenuItems(),
                onClick: ({ key }) => void onMoreMenuSelect(key),
              }}
            >
              <Button type="text" size="small" title={t.moreActions}>
                <EllipsisHorizontalOutline size={14} />
              </Button>
            </Dropdown>
          </div>
        </div>

        {workspacePaths.length && !workspaceCollapsed ? (
          <div className={styles.tree}>
            <div ref={workspaceTreeEl} className={styles.wsTree}>
              {workspacePaths.map((root) => {
                const treeItems = visibleTreeItemsFor(root);
                const rootSessions = sessionsFor(root);
                const expandedRoot = Boolean(expanded[root]);
                return (
                  <div key={root} data-ws-block data-root={root}>
                    <div
                      className={`${styles.wsRowWrap} ${
                        workspace.root === root && !sessionsStore.activeId
                          ? styles.wsRowWrapActive
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        className={styles.wsRow}
                        data-ws-row
                        title={root}
                        onClick={() => void onWorkspaceClick(root)}
                        onContextMenu={(e) => openWorkspaceCtx(e, root)}
                      >
                        <span
                          className={`${styles.chevron} ${
                            expandedRoot ? styles.chevronOpen : ""
                          }`}
                        >
                          <ChevronForwardOutline size={14} />
                        </span>
                        <Typography.Text
                          ellipsis={{ tooltip: workspaceName(root) }}
                          style={{ fontWeight: 600, flex: 1, minWidth: 0 }}
                        >
                          {workspaceName(root)}
                        </Typography.Text>
                      </button>
                      <Tooltip title={t.newSessionAction}>
                        <Button
                          className={styles.wsAction}
                          type="text"
                          shape="circle"
                          size="small"
                          data-no-ws-drag
                          onClick={(e) => void onNewAgentForWorkspace(root, e)}
                        >
                          <ChatboxOutline size={14} />
                        </Button>
                      </Tooltip>
                      <Tooltip title={t.moreActions}>
                        <Button
                          className={styles.wsAction}
                          type="text"
                          shape="circle"
                          size="small"
                          data-no-ws-drag
                          onClick={(e) => onWorkspaceMore(e, root)}
                        >
                          <EllipsisHorizontalOutline size={14} />
                        </Button>
                      </Tooltip>
                    </div>

                    <ul
                      className={`${styles.sessionList} ${
                        appearance.showSessionHoverActions
                          ? styles.sessionListHoverActions
                          : ""
                      }`}
                      data-no-ws-drag
                      ref={sessionListRef(root)}
                      style={{ display: expandedRoot ? undefined : "none" }}
                    >
                      {!rootSessions.length ? (
                        <li
                          className={styles.emptyInline}
                          data-no-session-drag
                        >
                          {t.emptySessions}
                        </li>
                      ) : null}
                      {treeItems.map((item, sIdx) => {
                        const sessionId = item.session.id;
                        const collapsedNode = isTreeNodeCollapsed(
                          root,
                          sessionId,
                        );
                        return (
                          <li
                            key={sessionId}
                            className={`${styles.sessionRow} ${
                              sessionsStore.activeId === sessionId
                                ? styles.sessionRowActive
                                : ""
                            } ${
                              guidesVisibleFor(root, item)
                                ? styles.sessionRowGuidesVisible
                                : ""
                            } ${
                              selectMode && isSessionSelected(sessionId)
                                ? styles.sessionRowSelected
                                : ""
                            }`}
                            data-session-row
                            data-id={sessionId}
                            data-no-ws-drag
                            style={
                              {
                                "--i": String(sIdx),
                                "--depth": item.depth,
                              } as CSSProperties
                            }
                            aria-expanded={
                              item.hasChildren ? !collapsedNode : undefined
                            }
                            onClick={(e) =>
                              selectMode
                                ? onSessionRowClick(sessionId, e.shiftKey)
                                : void onSelectSession(root, sessionId)
                            }
                            onContextMenu={(e) =>
                              openSessionCtx(e, root, item.session)
                            }
                            onMouseEnter={() => onSessionRowEnter(root, item)}
                            onMouseLeave={() => onSessionRowLeave(root)}
                          >
                            <div className={styles.sessionInner}>
                              {item.guideFull.map((full, gi) => (
                                <span
                                  key={gi}
                                  className={`${styles.treeGuide} ${
                                    full
                                      ? styles.treeGuideFull
                                      : gi === item.guideFull.length - 1
                                        ? styles.treeGuideElbow
                                        : styles.treeGuideEnded
                                  }`}
                                  style={{ "--g": gi } as CSSProperties}
                                  aria-hidden="true"
                                />
                              ))}
                              {item.depth > 0 && !item.isLastSibling ? (
                                <span
                                  className={styles.treeConnector}
                                  style={
                                    { "--g": item.depth - 1 } as CSSProperties
                                  }
                                  aria-hidden="true"
                                />
                              ) : null}
                              {item.hasChildren && !collapsedNode ? (
                                <span
                                  className={styles.treeDescender}
                                  style={{ "--g": item.depth } as CSSProperties}
                                  aria-hidden="true"
                                />
                              ) : null}
                              <span className={styles.activeBar} />
                              <span
                                className={`${styles.statusMark} ${
                                  styles[
                                    `st${(item.session.status || "idle").charAt(0).toUpperCase()}${(item.session.status || "idle").slice(1)}`
                                  ] ?? ""
                                }`}
                                aria-hidden="true"
                              >
                                <i className={styles.statusCore} />
                              </span>
                              {item.hasChildren ? (
                                <button
                                  type="button"
                                  className={`${styles.treeTwistie} ${
                                    collapsedNode ? styles.treeTwistieCollapsed : ""
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTreeNode(root, sessionId);
                                  }}
                                >
                                  <ChevronDownOutline size={16} />
                                </button>
                              ) : null}
                              <div className={styles.sessionBody}>
                                <div className={styles.sessionTitleRow}>
                                  {isPinned(root, sessionId) ? (
                                    <PinOutline
                                      className={styles.pin}
                                      size={11}
                                    />
                                  ) : null}
                                  <span className={styles.sessionLabel}>
                                    {sessionLabel(item.session)}
                                  </span>
                                </div>
                                <div className={styles.sessionMeta}>
                                  <span className={styles.time}>
                                    {relativeTime(item.session.modified)}
                                  </span>
                                  {isRunning(item.session.status) ? (
                                    <span
                                      className={`${styles.runTag} ${
                                        hasPendingAsk(sessionId)
                                          ? styles.runTagAsk
                                          : ""
                                      }`}
                                    >
                                      {hasPendingAsk(sessionId) ? "ask" : "live"}
                                    </span>
                                  ) : item.session.status === "error" ? (
                                    <span className={styles.errTag}>err</span>
                                  ) : item.session.status === "stuck" ? (
                                    <span className={styles.stuckTag}>stuck</span>
                                  ) : justEnded.has(sessionId) ? (
                                    <span className={styles.doneTag}>done</span>
                                  ) : null}
                                </div>
                              </div>
                              {selectMode ? (
                                <Checkbox
                                  className={styles.sessionCheck}
                                  checked={isSessionSelected(sessionId)}
                                  data-no-session-drag
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={() =>
                                    toggleSessionSelect(sessionId)
                                  }
                                />
                              ) : (
                                <Button
                                  className={styles.trash}
                                  type="text"
                                  shape="circle"
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmDeleteSession(root, sessionId);
                                  }}
                                >
                                  <TrashOutline size={14} />
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                      {hiddenSessionCount(root) > 0 ? (
                        <li
                          className={styles.sessionExpandRow}
                          data-no-session-drag
                        >
                          <button
                            type="button"
                            className={styles.sessionExpandBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSessionListExpanded(root);
                            }}
                          >
                            {t.showMoreSessions(hiddenSessionCount(root))}
                          </button>
                        </li>
                      ) : sessionListExpanded[root] &&
                        rootSessions.length > SESSION_VISIBLE_LIMIT ? (
                        <li
                          className={styles.sessionExpandRow}
                          data-no-session-drag
                        >
                          <button
                            type="button"
                            className={styles.sessionExpandBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSessionListExpanded(root);
                            }}
                          >
                            {t.collapseSessions(collapsibleSessionCount(root))}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ) : !workspaceCollapsed ? (
          <div className={styles.empty}>{t.emptyWorkspaces}</div>
        ) : null}
      </div>

      <div className="customize-bar">
        {customizeEntries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className={styles.customizeBtn}
            title={entry.label}
            onClick={() => openCustomize(entry.section)}
          >
            <CodiconIcon name={entry.name} size={16} />
            <span className={styles.customizeLabel}>{entry.label}</span>
          </button>
        ))}
      </div>

      <Modal
        open={renameOpen}
        title={t.renameSession}
        okText={t.save}
        cancelText={t.cancel}
        onOk={() => void submitRename().finally(() => setRenameOpen(false))}
        onCancel={() => setRenameOpen(false)}
      >
        <Input
          value={renameDraft}
          placeholder={t.sessionNamePlaceholder}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void submitRename();
          }}
        />
      </Modal>

      <Modal
        open={wsRenameOpen}
        title={t.renameProject}
        okText={t.save}
        cancelText={t.cancel}
        onOk={() =>
          void submitWorkspaceRename().finally(() => setWsRenameOpen(false))
        }
        onCancel={() => setWsRenameOpen(false)}
      >
        <Input
          value={wsRenameDraft}
          placeholder={t.renameProjectPlaceholder}
          onChange={(e) => setWsRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void submitWorkspaceRename();
          }}
        />
      </Modal>

      <Modal
        open={archivedOpen}
        className="pi-settings-modal"
        mask={{ closable: false }}
        width="min(520px, 92vw)"
        title={t.archivedSessions}
        onCancel={() => setArchivedOpen(false)}
        footer={
          <div className={styles.archivedActions}>
            <Button
              type="text"
              size="small"
              onClick={() => setArchivedOpen(false)}
            >
              {t.cancel}
            </Button>
            <Button
              type="text"
              size="small"
              disabled={!archivedSelected.length}
              onClick={() => void restoreSelectedArchived()}
            >
              {t.archiveRestore}
            </Button>
            <Button
              type="text"
              size="small"
              danger
              disabled={!archivedSelected.length}
              onClick={deleteSelectedArchived}
            >
              {t.delete}
            </Button>
          </div>
        }
      >
        <Input
          className={styles.archivedSearch}
          size="small"
          allowClear
          value={archivedQuery}
          placeholder={t.archiveSearchPlaceholder}
          onChange={(e) => setArchivedQuery(e.target.value)}
        />
        {!archivedFilteredRows.length ? (
          <div className={styles.archivedEmpty}>
            {archivedQuery.trim() ? t.archiveNoMatch : t.archiveEmpty}
          </div>
        ) : (
          <ul className={styles.archivedList}>
            {archivedFilteredRows.map((row) => (
              <li
                key={row.id}
                className={`${styles.archivedRow} ${
                  isArchivedSelected(row.id) ? styles.archivedRowSelected : ""
                }`}
                onClick={(e) => onArchivedRowClick(row.id, e.shiftKey)}
              >
                <Checkbox
                  className={styles.archivedCheck}
                  checked={isArchivedSelected(row.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleArchivedSelect(row.id)}
                />
                <div className={styles.archivedMeta}>
                  <span className={styles.archivedLabel}>{row.label}</span>
                  <span className={styles.archivedSub}>
                    {row.workspace}
                    {row.modified ? ` · ${relativeTime(row.modified)}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {ctx.show
        ? createPortal(
            <div className={styles.ctxAnchor} style={{ left: ctx.x, top: ctx.y }}>
              <Dropdown
                open
                trigger={[]}
                placement="bottomLeft"
                menu={{
                  items: ctxItems,
                  onClick: ({ key }) => void onCtxSelect(key),
                }}
              >
                <span className={styles.ctxAnchorTarget} />
              </Dropdown>
            </div>,
            document.body,
          )
        : null}
    </aside>
  );
}

export default SessionSidebar;
