<script setup lang="ts">
// pi-lens-ignore: 2305
import { computed, h, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import type { DropdownOption } from "naive-ui";
import {
  NAlert,
  NButton,
  NDropdown,
  NEllipsis,
  NIcon,
  NInput,
  NModal,
  NScrollbar,
  NSpace,
  NText,
  NTooltip,
  useDialog,
  useMessage,
} from "naive-ui";
import {
  AddOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseOutline,
  CopyOutline,
  FolderOpenOutline,
  PinOutline,
  RefreshOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import Sortable from "sortablejs";
import type { SessionStatus, SessionSummary } from "../../../shared/protocol";
import { SESSION_HISTORY_LOAD_LIMIT } from "../../../shared/protocol";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionWidgetsStore } from "@renderer/stores/session-widgets";
import { useChatStore } from "@renderer/stores/chat";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useLayoutStore } from "@renderer/stores/layout";
import { isUnstartedSession } from "@renderer/utils/session-started";
import { buildSessionTree, type SessionTreeItem } from "@renderer/utils/session-tree";
import { t } from "@renderer/i18n";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import { markRendererStartup } from "@renderer/utils/startup-timing";

const PIN_KEY = "session-pins:v1";
const SESSION_ORDER_KEY = "pi-desktop:session-order:v2";
const SESSION_VISIBLE_LIMIT = 5;

/** 左下角定制入口，自下而上依次：设置、挂钩、工具、智能体、指令、技能。 */
const customizeEntries = [
  { name: "skills", section: "skills", label: t.customizeSkills },
  { name: "instructions", section: "instructions", label: t.customizeInstructions },
  { name: "agents", section: "agents", label: t.customizeAgents },
  { name: "tools", section: "tools", label: t.customizeTools },
  { name: "hooks", section: "hooks", label: t.customizeHooks },
  { name: "settings", section: "general", label: t.customizeSettings },
] as const;

const sessionsStore = useSessionsStore();
const chatStore = useChatStore();
const sendQueueStore = useSendQueueStore();
const workspace = useWorkspaceStore();
const layout = useLayoutStore();
const dialog = useDialog();
const message = useMessage();

const sessionsByRoot = reactive<Record<string, SessionSummary[]>>({});
const expanded = reactive<Record<string, boolean>>({});
const pins = reactive<Record<string, string[]>>({});
const sessionOrders = reactive<Record<string, string[]>>({});
const sessionListExpanded = reactive<Record<string, boolean>>({});
const treeCollapsed = reactive<Record<string, Record<string, boolean>>>({});
const sessionListEls = new Map<string, HTMLElement>();
const sessionSortables = new Map<string, Sortable>();

const renameOpen = ref(false);
const renameDraft = ref("");
const renameTarget = ref<{ root: string; id: string } | null>(null);

const workspacePaths = computed(() => {
  const paths = [...workspace.recent];
  // Safety: active root missing from list — append, never promote to front.
  // A blank root is skipped: it would render as an extra nameless workspace.
  if (
    workspace.root?.trim() &&
    !paths.some((p) => p.toLowerCase() === workspace.root!.toLowerCase())
  ) {
    paths.push(workspace.root);
  }
  return paths;
});

/** Closed-workspace section collapsed state (default: expanded). */
const closedExpanded = ref(true);

function openCustomize(section: string): void {
  layout.openCustomize(section);
}

function toggleClosed(): void {
  closedExpanded.value = !closedExpanded.value;
}

/** Closed workspace paths not currently in the main list. */
const closedPaths = computed(() => {
  const keys = new Set(workspacePaths.value.map((p) => p.toLowerCase()));
  return workspace.closed.filter((p) => !keys.has(p.toLowerCase()));
});

async function onReopenClosed(root: string): Promise<void> {
  if (workspace.root && workspace.root !== root) {
    await discardActiveUnstartedForRoot(workspace.root);
  }
  // 重新打开成功后由 root watcher 统一加载会话并展开列表
  await workspace.reopenWorkspace(root);
}

/** Purge Pi config + sessions for a workspace (keeps project folder). */
async function purgeWorkspaceUi(root: string): Promise<void> {
  const sessionIds = (sessionsByRoot[root] ?? []).map((s) => s.id);
  await workspace.purgeWorkspace(root);
  for (const id of sessionIds) {
    chatStore.clearSession(id);
    sendQueueStore.clearSession(id);
  }
  delete sessionsByRoot[root];
  delete expanded[root];
  delete pins[root];
  persistPins();
  if (workspace.root) {
    expanded[workspace.root] = true;
    await loadSessions(workspace.root);
    await ensureActiveSession(workspace.root);
  } else {
    sessionsStore.activeId = null;
  }
}

function confirmPurgeWorkspace(root: string): void {
  const d = dialog.warning({
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

const workspaceTreeEl = ref<HTMLElement | null>(null);
let workspaceSortable: Sortable | null = null;

function destroyWorkspaceSortable(): void {
  workspaceSortable?.destroy();
  workspaceSortable = null;
}

function bindWorkspaceSortable(): void {
  destroyWorkspaceSortable();
  const el = workspaceTreeEl.value;
  if (!el || workspacePaths.value.length < 2) return;
  workspaceSortable = Sortable.create(el, {
    animation: 150,
    draggable: ".ws-block",
    handle: ".ws-row",
    filter: ".session-list, .session-row, .trash, .ws-new-session",
    preventOnFilter: false,
    onEnd: () => {
      const paths = [...el.querySelectorAll<HTMLElement>(".ws-block[data-root]")]
        .map((n) => n.dataset.root)
        .filter((p): p is string => Boolean(p));
      if (paths.length !== workspacePaths.value.length) return;
      const same = paths.every((p, i) => workspacePaths.value[i] === p);
      if (same) return;
      void workspace.reorderRecent(paths);
    },
  });
}

const activeSession = computed(() =>
  sessionsStore.activeId
    ? sessionsStore.sessions.find((s) => s.id === sessionsStore.activeId) ?? null
    : null,
);

const showStuckRecovery = computed(() => activeSession.value?.status === "stuck");

function loadPins(): void {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [k, v] of Object.entries(parsed)) {
      pins[k] = Array.isArray(v) ? v : [];
    }
  } catch {
    // ignore
  }
}

function persistPins(): void {
  localStorage.setItem(PIN_KEY, JSON.stringify({ ...pins }));
}

function loadSessionOrders(): void {
  try {
    const raw = localStorage.getItem(SESSION_ORDER_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [k, v] of Object.entries(parsed)) {
      sessionOrders[k] = Array.isArray(v) ? v : [];
    }
  } catch {
    // ignore
  }
}

function persistSessionOrders(): void {
  localStorage.setItem(SESSION_ORDER_KEY, JSON.stringify({ ...sessionOrders }));
}

function setSessionListRef(root: string, el: unknown): void {
  if (el instanceof HTMLElement) {
    sessionListEls.set(root, el);
    void nextTick(() => bindSessionSortable(root));
    return;
  }
  sessionSortables.get(root)?.destroy();
  sessionSortables.delete(root);
  sessionListEls.delete(root);
}

function bindSessionSortable(root: string): void {
  const el = sessionListEls.get(root);
  if (!el) return;
  sessionSortables.get(root)?.destroy();
  const sortable = Sortable.create(el, {
    animation: 150,
    draggable: ".session-row",
    filter: ".empty-inline, .session-expand-row",
    disabled:
      !sessionListExpanded[root] &&
      (sessionsByRoot[root]?.length ?? 0) > SESSION_VISIBLE_LIMIT,
    onEnd: () => {
      const ids = [...el.querySelectorAll<HTMLElement>(".session-row[data-id]")]
        .map((n) => n.dataset.id)
        .filter((id): id is string => Boolean(id));
      if (!ids.length) return;
      sessionOrders[root] = ids;
      // Keep pinned ids order in sync with visual order
      const pinned = new Set(pins[root] ?? []);
      if (pinned.size) {
        pins[root] = ids.filter((id) => pinned.has(id));
        persistPins();
      }
      persistSessionOrders();
    },
  });
  sessionSortables.set(root, sortable);
}

function destroySessionSortables(): void {
  for (const s of sessionSortables.values()) s.destroy();
  sessionSortables.clear();
  sessionListEls.clear();
}

function isPinned(root: string, id: string): boolean {
  return (pins[root] ?? []).includes(id);
}

function togglePin(root: string, id: string): void {
  const list = [...(pins[root] ?? [])];
  const idx = list.indexOf(id);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(id);
  pins[root] = list;
  persistPins();
}

onMounted(async () => {
  markRendererStartup("renderer:sidebar-mounted");
  loadPins();
  loadSessionOrders();
  sessionsStore.bindEvents();
  // 派生会话等由其他组件新建的会话：排到最前，避免被折叠到「展开其余 N 个」之下。
  window.addEventListener("pi-session-created", onSessionCreated);
  // App.vue already loads workspace/recent — skip duplicate IPC on cold start.
  const boot: Promise<unknown>[] = [workspace.listClosed()];
  if (!workspace.root) boot.push(workspace.getWorkspace());
  if (!workspace.recent.length) boot.push(workspace.listRecentFast());
  await Promise.all(boot);
  if (workspace.root && workspace.sessionsReady) {
    try {
      await loadSessions(workspace.root);
    } finally {
      expanded[workspace.root] = true;
    }
    await ensureActiveSession(workspace.root);
  }
  void nextTick(() => bindWorkspaceSortable());
});

onUnmounted(() => {
  window.removeEventListener("pi-session-created", onSessionCreated);
  destroyWorkspaceSortable();
  destroySessionSortables();
});

watch(
  () => workspacePaths.value.join("\0"),
  () => {
    void nextTick(() => bindWorkspaceSortable());
  },
);

watch(
  () => [workspace.root, workspace.sessionsReady] as const,
  async ([root, ready]) => {
    if (!root || !ready) return;
    try {
      // 先加载再展开，避免展开瞬间露出空列表或上一工作区的会话
      await loadSessions(root);
    } finally {
      expanded[root] = true;
    }
    await ensureActiveSession(root);
  },
);

/** Merge live status into tree without wiping names / firstMessage. */
watch(
  () =>
    sessionsStore.sessions
      .map(
        (s) =>
          `${s.id}:${s.status}:${s.name ?? ""}:${s.modified}:${s.firstMessage ?? ""}`,
      )
      .join("|"),
  () => {
    const root = workspace.root;
    if (!root) return;
    // 切换间隙 store 仍是上一工作区的列表，跳过合并以免污染本工作区的缓存
    if (sessionsStore.listRoot !== root) return;
    const list = sessionsStore.sessions;
    const byId = new Map(list.map((s) => [s.id, s]));
    const current = sessionsByRoot[root] ?? [];
    if (!current.length) {
      sessionsByRoot[root] = list.map((s) => ({ ...s }));
      return;
    }
    // Drop rows the live store no longer knows (deleted elsewhere) — but keep
    // them while the store list is empty (root not loaded yet).
    const alive = current.filter(
      (row) => list.length === 0 || byId.has(row.id),
    );
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
    sessionsByRoot[root] = next;
  },
);

function compareSessions(
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

function sessionsFor(root: string): SessionSummary[] {
  // 只渲染各工作区自己的缓存：活跃区的行由下方 watcher 同步 store 的实时更新，
  // 切换工作区时列表不会先闪现上一个工作区的会话（避免行重建与入场动画闪烁）。
  const list = [...(sessionsByRoot[root] ?? [])];
  return buildSessionTree(list, compareSessions(root))
    .filter((item) => item.depth === 0)
    .map((item) => item.session);
}

type VisibleSessionItem = SessionTreeItem & {
  /** 所属顶层会话 id：悬停任一层级时整组显示导线。 */
  topId: string | null;
  /** 每个祖先层级：竖线是否贯穿整行（末级否则画弯头，中间级否则不画）。 */
  guideFull: boolean[];
  /** 是否为父级的最后一个子会话（末级导线以圆角弯头收尾）。 */
  isLastSibling: boolean;
};

function visibleTreeItemsFor(root: string): VisibleSessionItem[] {
  const items = buildSessionTree(
    [...(sessionsByRoot[root] ?? [])],
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
  const rootCount = visible.reduce((n, item) => (item.depth === 0 ? n + 1 : n), 0);
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

function isTreeNodeCollapsed(root: string, sessionId: string): boolean {
  return Boolean(treeCollapsed[root]?.[sessionId]);
}

function toggleTreeNode(root: string, sessionId: string): void {
  const map = (treeCollapsed[root] ??= {});
  map[sessionId] = !map[sessionId];
}

/** 悬停中的会话层级（按工作区记录顶层会话 id），驱动层级导线的显隐。 */
const hoverGuides = reactive<Record<string, string | null>>({});

function onSessionRowEnter(root: string, item: VisibleSessionItem): void {
  if (item.topId) hoverGuides[root] = item.topId;
}

function onSessionRowLeave(root: string): void {
  hoverGuides[root] = null;
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

function hiddenSessionCount(root: string): number {
  if (sessionListExpanded[root]) return 0;
  return Math.max(0, sessionsFor(root).length - SESSION_VISIBLE_LIMIT);
}

function toggleSessionListExpanded(root: string): void {
  sessionListExpanded[root] = !sessionListExpanded[root];
  void nextTick(() => bindSessionSortable(root));
}

/** Freeze current visual order and prepend a new session id at the front. */
function appendSessionToOrder(root: string, sessionId: string): void {
  const base = sessionsFor(root)
    .map((s) => s.id)
    .filter((id) => id !== sessionId);
  sessionOrders[root] = [sessionId, ...base];
  persistSessionOrders();
}

/** 其他组件（如派生对话）建出的会话：置顶显示，折叠状态下也能看到。 */
function onSessionCreated(event: Event): void {
  const detail = (event as CustomEvent<{ root?: unknown; sessionId?: unknown }>).detail;
  const root = typeof detail?.root === "string" ? detail.root : "";
  const sessionId = typeof detail?.sessionId === "string" ? detail.sessionId : "";
  if (!root || !sessionId) return;
  appendSessionToOrder(root, sessionId);
}

async function loadSessions(root: string): Promise<void> {
  markRendererStartup("renderer:sessions-request");
  const list = await window.api.sessions.list(root);
  sessionsByRoot[root] = list;
  if (root === workspace.root) {
    sessionsStore.sessions = list;
    sessionsStore.listRoot = root;
  }
  useSessionWidgetsStore().pruneStaleTodoSnapshots(
    new Set(list.map((s) => s.id)),
  );
  markRendererStartup("renderer:ready");
}

function sameWorkspacePath(a: string, b: string): boolean {
  const norm = (p: string) =>
    p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

async function ensureActiveSession(root: string): Promise<void> {
  // 草稿态没有真实会话：同一工作区保留，切到别的目录则放弃。
  if (sessionsStore.draftRoot) {
    if (sameWorkspacePath(sessionsStore.draftRoot, root)) return;
    sessionsStore.draftRoot = null;
  }
  const list = sessionsByRoot[root] ?? [];
  if (sessionsStore.activeId && list.some((s) => s.id === sessionsStore.activeId)) {
    // Re-open so main-process broker always has the session (cold start / HMR).
    await onSelectSession(root, sessionsStore.activeId);
    return;
  }
  const first = sessionsFor(root)[0];
  if (first) await onSelectSession(root, first.id);
}

function workspaceName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() ?? path;
}

async function onWorkspaceClick(path: string): Promise<void> {
  const wasExpanded = Boolean(expanded[path]);
  if (workspace.root !== path) {
    // Leaving the current workspace also abandons an unstarted 新会话 there.
    await discardActiveUnstartedForRoot(workspace.root);
    const next = await workspace.openWorkspacePath(path);
    // 切换成功后由 root watcher 统一加载并展开，避免重复加载造成列表二次渲染；
    // 未切换（如拒绝信任）时仍允许展开查看列表
    if (next === path) return;
    expanded[path] = true;
    await loadSessions(path);
    return;
  }
  expanded[path] = !wasExpanded;
  if (expanded[path]) await loadSessions(path);
}

async function onNewAgent(): Promise<void> {
  if (workspace.trustDialogOpen) return;
  let root = workspace.root;
  if (!root) root = await workspace.openWorkspace();
  if (!root) return;
  await onNewAgentForWorkspace(root);
}

async function onNewAgentForWorkspace(root: string, event?: Event): Promise<void> {
  event?.stopPropagation();
  event?.preventDefault();
  if (workspace.trustDialogOpen) return;
  // 在别的目录新建会放弃当前未使用的空会话。
  if (workspace.root && workspace.root !== root) {
    await discardActiveUnstartedForRoot(workspace.root);
  }
  if (workspace.root !== root) {
    await workspace.openWorkspacePath(root);
  }
  if (workspace.trustDialogOpen || !workspace.sessionsReady) return;
  expanded[root] = true;
  sessionsStore.beginDraft(root);
}

async function onAddWorkspace(): Promise<void> {
  const root = await workspace.openWorkspace();
  if (!root) return;
  expanded[root] = true;
  await loadSessions(root);
}

/** Discard the active session (of a root) when the user leaves it unstarted. */
async function discardActiveUnstartedForRoot(root: string | null): Promise<void> {
  if (!root) return;
  const id = sessionsStore.activeId;
  if (!id) return;
  const row =
    (sessionsByRoot[root] ?? []).find((s) => s.id === id) ??
    sessionsStore.sessions.find((s) => s.id === id) ??
    null;
  if (row && isUnstartedSession(row)) {
    await discardUnstartedSession(root, id);
  }
}

/** Delete an unstarted (never-chatted, never-renamed) session silently. */
async function discardUnstartedSession(root: string, sessionId: string): Promise<void> {
  const stillThere =
    sessionsStore.sessions.some((s) => s.id === sessionId) ||
    (sessionsByRoot[root] ?? []).some((s) => s.id === sessionId);
  if (!stillThere) return;
  try {
    await sessionsStore.deleteSession(sessionId, root);
    chatStore.clearSession(sessionId);
    sendQueueStore.clearSession(sessionId);
    pins[root] = (pins[root] ?? []).filter((id) => id !== sessionId);
    sessionOrders[root] = (sessionOrders[root] ?? []).filter((id) => id !== sessionId);
    sessionsByRoot[root] = (sessionsByRoot[root] ?? []).filter(
      (s) => s.id !== sessionId,
    );
    persistPins();
    persistSessionOrders();
  } catch (err) {
    console.error("discard unstarted session failed", err);
  }
}

async function onSelectSession(root: string, sessionId: string): Promise<void> {
  // An active 新会话 the user never chatted with is dropped when they leave it
  // (click another session / switch workspace) instead of lingering on disk.
  const leavingId = sessionsStore.activeId;
  let leaving: SessionSummary | null = null;
  let leavingRoot = "";
  if (leavingId && leavingId !== sessionId) {
    // The active row may live in another workspace's cached tree while the
    // workspace switch is reloading the store list — locate it anywhere.
    for (const [r, rows] of Object.entries(sessionsByRoot)) {
      const found = rows.find((s) => s.id === leavingId);
      if (found) {
        leaving = found;
        leavingRoot = r;
        break;
      }
    }
    if (!leaving) {
      leaving =
        sessionsStore.sessions.find((s) => s.id === leavingId) ?? null;
      leavingRoot = leaving?.cwd || workspace.root || root;
    }
  }
  const discardLeaving = Boolean(leaving && isUnstartedSession(leaving));
  // Cross-workspace clicks must discard BEFORE the root switch wipes the store
  // list; same-workspace discards wait until the new session is active so the
  // UI never flashes an empty state between the two IPC round-trips.
  if (discardLeaving && workspace.root !== null && workspace.root !== root) {
    await discardUnstartedSession(leavingRoot, leaving!.id);
  }
  chatStore.beginHistoryLoad(sessionId);
  try {
    if (workspace.root !== root) await workspace.openWorkspacePath(root);
    const opened =
      (sessionsByRoot[root] ?? []).find((s) => s.id === sessionId) ??
      sessionsStore.sessions.find((s) => s.id === sessionId);
    // Load history from disk in parallel with opening the session in main:
    // history only needs the file path, so the two round-trips no longer stack.
    const historyPromise = opened?.filePath
      ? window.api.sessions.history(opened.filePath, { limit: SESSION_HISTORY_LOAD_LIMIT })
      : Promise.resolve({ messages: [], hasMore: false, total: 0 });
    const [page] = await Promise.all([
      historyPromise,
      sessionsStore.selectSession(sessionId, root),
    ]);
    chatStore.hydrateFromHistory(sessionId, page.messages);
    if (discardLeaving && workspace.root === root) {
      await discardUnstartedSession(leavingRoot, leaving!.id);
    }
  } catch (err) {
    console.error("select session failed", err);
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    chatStore.endHistoryLoad(sessionId);
  }
}

async function onKill(): Promise<void> {
  if (!sessionsStore.activeId || !workspace.root) return;
  await sessionsStore.killWorker(sessionsStore.activeId, workspace.root);
}

async function onRestart(): Promise<void> {
  if (!sessionsStore.activeId || !workspace.root) return;
  await sessionsStore.restartWorker(sessionsStore.activeId, workspace.root);
}

function confirmDeleteSession(root: string, sessionId: string): void {
  const session = (sessionsByRoot[root] ?? []).find((s) => s.id === sessionId);
  const label = sessionLabel(session ?? { id: sessionId });
  const d = dialog.warning({
    title: t.deleteSession,
    content: t.deleteConfirm(label),
    positiveText: t.delete,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return (async () => {
        try {
          if (workspace.root !== root) await workspace.openWorkspacePath(root);
          await sessionsStore.deleteSession(sessionId, root);
          chatStore.clearSession(sessionId);
          sendQueueStore.clearSession(sessionId);
          pins[root] = (pins[root] ?? []).filter((id) => id !== sessionId);
          persistPins();
          await loadSessions(root);
          await ensureActiveSession(root);
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
  renameTarget.value = { root, id: sessionId };
  renameDraft.value = sessionLabel(session ?? { id: sessionId });
  renameOpen.value = true;
}

async function submitRename(): Promise<void> {
  const target = renameTarget.value;
  const name = renameDraft.value.trim();
  if (!target || !name) return;
  try {
    await sessionsStore.renameSession(target.id, target.root, name);
    await loadSessions(target.root);
    renameOpen.value = false;
    message.success(t.renamed);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function sessionLabel(session: { name?: string; firstMessage?: string; id: string }): string {
  if (session.name?.trim()) return session.name.trim();
  if (session.firstMessage?.trim() && session.firstMessage !== "(no messages)") {
    const text = session.firstMessage.trim();
    return text.length > 42 ? `${text.slice(0, 39)}…` : text;
  }
  return t.newSession;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function workspaceMenuOptions(): DropdownOption[] {
  return [
    {
      label: t.openFolder,
      key: "open",
      icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }),
    },
    {
      label: t.newSessionAction,
      key: "new-session",
      icon: () => h(NIcon, null, { default: () => h(AddOutline) }),
    },
    {
      label: t.refreshSessions,
      key: "refresh",
      icon: () => h(NIcon, null, { default: () => h(RefreshOutline) }),
    },
    {
      label: t.revealInExplorer,
      key: "reveal",
      icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }),
    },
    {
      label: t.copyPath,
      key: "copy",
      icon: () => h(NIcon, null, { default: () => h(CopyOutline) }),
    },
    { type: "divider", key: "d1" },
    {
      label: t.closeWorkspace,
      key: "close",
      icon: () => h(NIcon, null, { default: () => h(CloseOutline) }),
    },
    {
      label: t.removeFromList,
      key: "remove",
      icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
    },
  ];
}

async function onWorkspaceMenu(root: string, key: string | number): Promise<void> {
  closeCtx();
  const k = String(key);
  switch (k) {
    case "open":
      await onWorkspaceClick(root);
      if (!expanded[root]) {
        expanded[root] = true;
        await loadSessions(root);
      }
      break;
    case "new-session": {
      if (workspace.trustDialogOpen) return;
      if (workspace.root !== root) await workspace.openWorkspacePath(root);
      if (workspace.trustDialogOpen || !workspace.sessionsReady) return;
      expanded[root] = true;
      sessionsStore.beginDraft(root);
      break;
    }
    case "refresh":
      expanded[root] = true;
      await loadSessions(root);
      message.success(t.refreshed);
      break;
    case "reveal":
      await workspace.revealInFolder(root);
      break;
    case "copy":
      await navigator.clipboard.writeText(root);
      message.success(t.pathCopied);
      break;
    case "close": {
      // Close = hide from the main list; the workspace moves to the
      // "Closed workspaces" section and can be reopened later.
      // An unstarted 新会话 left open there has no value — drop it first.
      if (sessionsStore.activeId && root === workspace.root) {
        await discardActiveUnstartedForRoot(root);
      }
      await workspace.closeWorkspace(root);
      delete sessionsByRoot[root];
      delete expanded[root];
      if (workspace.root) {
        expanded[workspace.root] = true;
        await loadSessions(workspace.root);
        await ensureActiveSession(workspace.root);
      } else {
        sessionsStore.activeId = null;
      }
      break;
    }
    case "remove": {
      confirmPurgeWorkspace(root);
      break;
    }
    default:
      break;
  }
}

function sessionMenu(root: string, session: SessionSummary): DropdownOption[] {
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
        chatStore.clearSession(session.id);
        chatStore.hydrateFromHistory(session.id, []);
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

const ctx = ref({
  show: false,
  x: 0,
  y: 0,
  kind: "workspace" as "workspace" | "session",
  root: "",
  session: null as SessionSummary | null,
});

const ctxOptions = computed<DropdownOption[]>(() => {
  if (ctx.value.kind === "workspace") return workspaceMenuOptions();
  if (ctx.value.session) return sessionMenu(ctx.value.root, ctx.value.session);
  return [];
});

function closeCtx(): void {
  ctx.value.show = false;
}

function openWorkspaceCtx(e: MouseEvent, root: string): void {
  e.preventDefault();
  e.stopPropagation();
  ctx.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    kind: "workspace",
    root,
    session: null,
  };
}

function openSessionCtx(e: MouseEvent, root: string, session: SessionSummary): void {
  e.preventDefault();
  e.stopPropagation();
  ctx.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    kind: "session",
    root,
    session,
  };
}

async function onCtxSelect(key: string | number): Promise<void> {
  if (ctx.value.kind === "workspace") {
    await onWorkspaceMenu(ctx.value.root, key);
    return;
  }
  if (ctx.value.session) {
    await onSessionMenu(ctx.value.root, ctx.value.session, key);
  }
}

function isRunning(status: SessionStatus): boolean {
  return status === "running";
}
</script>

<template>
  <aside class="sidebar">
    <div class="top-actions">
      <NButton
        secondary
        strong
        size="small"
        class="pi-interactive top-btn"
        :disabled="workspace.trustDialogOpen"
        @click="onAddWorkspace"
      >
        <template #icon>
          <NIcon :component="FolderOpenOutline" :size="14" />
        </template>
        <span class="btn-label">{{ t.openWorkspace }}</span>
      </NButton>
      <NButton
        secondary
        strong
        size="small"
        class="pi-interactive top-btn"
        :disabled="workspace.trustDialogOpen"
        @click="onNewAgent"
      >
        <template #icon>
          <NIcon :component="AddOutline" :size="14" />
        </template>
        <span class="btn-label">{{ t.newSessionAction }}</span>
      </NButton>
    </div>

    <NAlert v-if="showStuckRecovery" type="warning" :bordered="false" style="margin: 0 8px 8px">
      {{ t.stuckBanner }}
      <NSpace style="margin-top: 6px">
        <NButton size="tiny" type="error" @click="onKill">{{ t.terminate }}</NButton>
        <NButton size="tiny" @click="onRestart">{{ t.restart }}</NButton>
      </NSpace>
    </NAlert>

    <div class="sessions-pane">
      <div class="section-head">
        <NText depth="3" style="font-size: 12px; font-weight: 600">{{ t.workspaces }}</NText>
      </div>

      <NScrollbar v-if="workspacePaths.length" class="tree">
        <div ref="workspaceTreeEl" class="ws-tree">
          <div
            v-for="root in workspacePaths"
            :key="root"
            class="ws-block"
            :data-root="root"
          >
          <div class="ws-row-wrap">
            <button
              type="button"
              class="ws-row"
              :class="{ active: workspace.root === root && !sessionsStore.activeId }"
              :title="root"
              @click="onWorkspaceClick(root)"
              @contextmenu="(e) => openWorkspaceCtx(e, root)"
            >
              <span class="chevron" :class="{ open: expanded[root] }">
                <NIcon :component="ChevronForwardOutline" :size="14" />
              </span>
              <NEllipsis style="font-weight: 600; flex: 1; min-width: 0">{{
                workspaceName(root)
              }}</NEllipsis>
            </button>
            <NTooltip>
              <template #trigger>
                <NButton
                  class="ws-new-session"
                  quaternary
                  circle
                  size="tiny"
                  :disabled="workspace.trustDialogOpen"
                  @click="(e) => void onNewAgentForWorkspace(root, e)"
                >
                  <template #icon>
                    <NIcon :component="AddOutline" :size="14" />
                  </template>
                </NButton>
              </template>
              {{ t.newSessionAction }}
            </NTooltip>
          </div>

          <ul
            v-show="expanded[root]"
            class="session-list"
            :class="{ open: expanded[root] }"
            :ref="(el) => setSessionListRef(root, el)"
          >
            <li v-if="!sessionsFor(root).length" class="empty-inline">{{ t.emptySessions }}</li>
            <li
              v-for="(item, sIdx) in visibleTreeItemsFor(root)"
              :key="item.session.id"
              class="session-row"
              :data-id="item.session.id"
              :class="{
                active: sessionsStore.activeId === item.session.id,
                running: isRunning(item.session.status),
                'guides-visible': guidesVisibleFor(root, item),
              }"
              :style="{ '--i': String(sIdx), '--depth': item.depth }"
              :aria-expanded="
                item.hasChildren
                  ? !isTreeNodeCollapsed(root, item.session.id)
                  : undefined
              "
              @click="onSelectSession(root, item.session.id)"
              @contextmenu="(e) => openSessionCtx(e, root, item.session)"
              @mouseenter="onSessionRowEnter(root, item)"
              @mouseleave="onSessionRowLeave(root)"
            >
              <div class="session-inner">
                <span
                  v-for="(full, gi) in item.guideFull"
                  :key="gi"
                  class="tree-guide"
                  :class="{
                    full,
                    elbow: !full && gi === item.guideFull.length - 1,
                    ended: !full && gi < item.guideFull.length - 1,
                  }"
                  :style="{ '--g': gi }"
                  aria-hidden="true"
                />
                <span
                  v-if="item.depth > 0 && !item.isLastSibling"
                  class="tree-connector"
                  :style="{ '--g': item.depth - 1 }"
                  aria-hidden="true"
                />
                <span
                  v-if="item.hasChildren && !isTreeNodeCollapsed(root, item.session.id)"
                  class="tree-descender"
                  :style="{ '--g': item.depth }"
                  aria-hidden="true"
                />
                <span class="active-bar" />
                <span class="status-mark" :class="`st-${item.session.status || 'idle'}`" aria-hidden="true">
                  <i class="status-core" />
                </span>
                <button
                  v-if="item.hasChildren"
                  type="button"
                  class="tree-twistie"
                  :class="{ collapsed: isTreeNodeCollapsed(root, item.session.id) }"
                  @click.stop="toggleTreeNode(root, item.session.id)"
                >
                  <NIcon :component="ChevronDownOutline" :size="16" />
                </button>
                <div class="session-body">
                  <div class="session-title-row">
                    <NIcon
                      v-if="isPinned(root, item.session.id)"
                      class="pin"
                      :component="PinOutline"
                      :size="11"
                    />
                    <span class="session-label">{{ sessionLabel(item.session) }}</span>
                  </div>
                  <div class="session-meta">
                    <span class="time">{{ relativeTime(item.session.modified) }}</span>
                    <span v-if="isRunning(item.session.status)" class="run-tag">live</span>
                    <span v-else-if="item.session.status === 'error'" class="err-tag">err</span>
                    <span v-else-if="item.session.status === 'stuck'" class="stuck-tag">stuck</span>
                  </div>
                </div>
                <NButton
                  class="trash"
                  quaternary
                  circle
                  size="tiny"
                  @click.stop="confirmDeleteSession(root, item.session.id)"
                >
                  <template #icon>
                    <NIcon :component="TrashOutline" :size="14" />
                  </template>
                </NButton>
              </div>
            </li>
            <li v-if="hiddenSessionCount(root) > 0" class="session-expand-row">
              <button
                type="button"
                class="session-expand-btn"
                @click.stop="toggleSessionListExpanded(root)"
              >
                {{ t.showMoreSessions(hiddenSessionCount(root)) }}
              </button>
            </li>
            <li
              v-else-if="
                sessionListExpanded[root] &&
                sessionsFor(root).length > SESSION_VISIBLE_LIMIT
              "
              class="session-expand-row"
            >
              <button
                type="button"
                class="session-expand-btn"
                @click.stop="toggleSessionListExpanded(root)"
              >
                {{ t.collapseSessions }}
              </button>
            </li>
          </ul>
          </div>
        </div>
      </NScrollbar>
      <div v-else class="empty">{{ t.emptyWorkspaces }}</div>

      <!-- Closed workspaces (collapsed section, re-openable) -->
      <div v-if="closedPaths.length" class="closed-ws">
        <button
          type="button"
          class="closed-ws-head"
          :aria-expanded="closedExpanded"
          @click="toggleClosed"
        >
          <span class="chevron" :class="{ open: closedExpanded }">
            <NIcon :component="ChevronForwardOutline" :size="13" />
          </span>
          <span class="closed-ws-title">{{ t.closedWorkspaces }}</span>
          <span class="closed-ws-count">{{ closedPaths.length }}</span>
        </button>
        <div v-if="closedExpanded" class="closed-ws-list">
          <div
            v-for="root in closedPaths"
            :key="root"
            class="closed-ws-row"
            :title="root"
          >
            <button
              type="button"
              class="closed-ws-open"
              @click="() => void onReopenClosed(root)"
            >
              <span class="closed-ws-name">{{ workspaceName(root) }}</span>
            </button>
            <NTooltip>
              <template #trigger>
                <NButton
                  quaternary
                  size="tiny"
                  class="closed-ws-remove"
                  :aria-label="t.removeFromList"
                  @click.stop="confirmPurgeWorkspace(root)"
                >
                  <template #icon>
                    <NIcon :component="TrashOutline" :size="13" />
                  </template>
                </NButton>
              </template>
              {{ t.removeFromList }}
            </NTooltip>
          </div>
        </div>
      </div>
    </div>

    <div class="customize-bar">
      <button
        v-for="entry in customizeEntries"
        :key="entry.name"
        type="button"
        class="customize-btn"
        :title="entry.label"
        @click="openCustomize(entry.section)"
      >
        <CodiconIcon :name="entry.name" :size="16" />
        <span class="customize-label">{{ entry.label }}</span>
      </button>
    </div>

    <NModal
      v-model:show="renameOpen"
      preset="dialog"
      :title="t.renameSession"
      :positive-text="t.save"
      :negative-text="t.cancel"
      @positive-click="submitRename"
    >
      <NInput v-model:value="renameDraft" :placeholder="t.sessionNamePlaceholder" @keydown.enter.prevent="submitRename" />
    </NModal>

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctx.x"
      :y="ctx.y"
      :show="ctx.show"
      :options="ctxOptions"
      @clickoutside="closeCtx"
      @select="onCtxSelect"
    />
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-sidebar);
  min-width: 0;
  border-right: 1px solid var(--border);
}

.sessions-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.top-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 6px 4px;
  flex-shrink: 0;
  position: relative;
  z-index: 6;
  background: var(--bg-sidebar);
}

.top-btn {
  flex: 1;
  min-width: 0;
  padding: 0 6px;
  height: 26px;
  font-size: 12px;
}

.top-btn .btn-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px 2px;
  flex-shrink: 0;
}

.tree {
  flex: 1;
  min-height: 0;
  padding: 0 6px 8px;
}

/* Closed workspaces section (collapsed, re-openable). */
.closed-ws {
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.15));
  padding: 6px;
}

.closed-ws-head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  margin: 0;
  padding: 3px 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted, #888);
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.closed-ws-head:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.07));
}

.closed-ws-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.closed-ws-count {
  font-size: 10.5px;
  color: var(--fg-faint, #999);
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  border-radius: 999px;
  padding: 0 7px;
}

.closed-ws-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 3px;
}

.closed-ws-row {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  padding: 1px 4px 1px 18px;
  border-radius: 6px;
}

.closed-ws-row:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.07));
}

.closed-ws-open {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 4px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted, #888);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.closed-ws-open:hover {
  color: var(--fg, #ddd);
}

.closed-ws-remove {
  flex-shrink: 0;
  opacity: 0.55;
}

.closed-ws-row:hover .closed-ws-remove {
  opacity: 1;
}

.closed-ws-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ws-row-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  border-radius: var(--radius-sm, 4px);
}

.ws-row-wrap:hover,
.ws-row-wrap:focus-within {
  background: var(--bg-hover);
}

.ws-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-strong);
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.01em;
  text-align: left;
  cursor: grab;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.ws-row:active {
  cursor: grabbing;
}

.ws-row.active {
  background: var(--bg-hover);
}

.ws-new-session {
  flex-shrink: 0;
  margin-right: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--duration-fast, 140ms) var(--ease-out, ease);
}

.ws-row-wrap:hover .ws-new-session,
.ws-row-wrap:focus-within .ws-new-session {
  opacity: 1;
  pointer-events: auto;
}

.chevron {
  display: inline-flex;
  color: var(--fg-faint);
  transition: transform var(--duration-fast, 140ms) var(--ease-out, ease);
}

.chevron.open {
  transform: rotate(90deg);
}

.session-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 2px 0 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-row {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
  border-radius: 6px;
  font-size: 13px;
  color: var(--fg-muted);
  cursor: pointer;
  animation: session-row-in 220ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)) both;
  animation-delay: calc(min(var(--i, 0), 12) * 18ms);
}

@keyframes session-row-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.session-inner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 7px 8px;
  padding-left: calc(8px + var(--depth, 0) * 24px);
  border-radius: 6px;
  border: 1px solid transparent;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    color var(--duration-fast, 140ms) var(--ease-out, ease),
    border-color var(--duration-fast, 140ms) var(--ease-out, ease),
    box-shadow var(--duration-fast, 140ms) var(--ease-out, ease),
    transform var(--duration-fast, 140ms) var(--ease-out, ease);
}

.session-row:hover .session-inner {
  background: var(--bg-hover);
  color: var(--fg);
}

.session-row:active .session-inner {
  transform: scale(0.992);
}

.session-row.active .session-inner {
  background: var(--bg-selected);
  border-color: var(--border);
  color: var(--fg-strong);
  box-shadow: none;
}

.active-bar {
  position: absolute;
  left: calc(2px + var(--depth, 0) * 24px);
  top: 11px;
  bottom: 11px;
  width: 2.5px;
  border-radius: 999px;
  background: transparent;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    transform var(--duration-fast, 140ms) var(--ease-out, ease);
  transform: scaleY(0.4);
}

.tree-guide {
  position: absolute;
  top: -1px;
  bottom: 50%;
  left: calc(16px + var(--g, 0) * 24px);
  width: 0;
  border-left: 1px solid color-mix(in srgb, var(--fg-faint) 40%, transparent);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s linear;
}

.tree-guide.full {
  bottom: -1px;
}

.tree-guide.elbow {
  width: 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--fg-faint) 40%, transparent);
  border-bottom-left-radius: 4px;
}

.tree-guide.ended {
  display: none;
}

.tree-connector {
  position: absolute;
  top: calc(50% - 0.5px);
  left: calc(16px + var(--g, 0) * 24px);
  width: 12px;
  border-top: 1px solid color-mix(in srgb, var(--fg-faint) 40%, transparent);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s linear;
}

.tree-descender {
  position: absolute;
  top: calc(50% + 12px);
  bottom: -2px;
  left: calc(16px + var(--g, 0) * 24px);
  width: 0;
  border-left: 1px solid color-mix(in srgb, var(--fg-faint) 40%, transparent);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s linear;
}

.session-row.guides-visible .tree-guide,
.session-row.guides-visible .tree-connector,
.session-row.guides-visible .tree-descender {
  opacity: 1;
}

.session-row.active .active-bar {
  background: var(--accent);
  transform: scaleY(1);
}

.status-mark {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
}

.tree-twistie {
  position: absolute;
  top: 50%;
  left: calc(8px + var(--depth, 0) * 24px);
  width: 16px;
  height: 16px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%);
  z-index: 1;
}

.tree-twistie.collapsed {
  transform: translateY(-50%) rotate(-90deg);
}

.session-row:hover .tree-twistie,
.tree-twistie:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.session-row:hover[aria-expanded] .status-mark {
  visibility: hidden;
}

.status-core {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-faint);
  display: block;
}

.st-idle .status-core {
  background: color-mix(in srgb, var(--fg-faint) 55%, transparent);
}

.st-running .status-core {
  background: var(--green);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--green) 45%, transparent);
  animation: status-pulse 1.4s ease-out infinite;
}

.st-error .status-core {
  background: var(--red);
}

.st-stuck .status-core {
  background: var(--warning);
}

@keyframes status-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--green) 45%, transparent);
  }
  70% {
    box-shadow: 0 0 0 6px transparent;
  }
  100% {
    box-shadow: 0 0 0 0 transparent;
  }
}

.session-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.session-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.session-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 550;
  letter-spacing: -0.01em;
  line-height: 1.25;
}

.session-row.active .session-label {
  font-weight: 650;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 14px;
  padding-left: 1px;
}

.time {
  font-size: 10.5px;
  color: var(--fg-faint);
  font-variant-numeric: tabular-nums;
}

.run-tag,
.err-tag,
.stuck-tag {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0 5px;
  border-radius: 999px;
  line-height: 14px;
}

.run-tag {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 14%, transparent);
}

.err-tag {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 14%, transparent);
}

.stuck-tag {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
}

.trash {
  opacity: 0;
  flex-shrink: 0;
  transition: opacity var(--duration-fast, 140ms) var(--ease-out, ease);
}

.session-row:hover .trash {
  opacity: 1;
}

.pin {
  flex-shrink: 0;
  color: var(--accent);
  opacity: 0.9;
}

@media (prefers-reduced-motion: reduce) {
  .session-row,
  .st-running .status-core {
    animation: none !important;
  }
}

.empty,
.empty-inline {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--fg-faint);
}

.session-expand-row {
  list-style: none;
  margin: 0;
  padding: 0;
}

.session-expand-btn {
  width: 100%;
  margin: 0;
  padding: 5px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-faint);
  font: inherit;
  font-size: 11.5px;
  text-align: center;
  cursor: pointer;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    color var(--duration-fast, 140ms) var(--ease-out, ease);
}

.session-expand-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.customize-bar {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-shrink: 0;
  padding: 4px 6px 6px;
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.15));
}

.customize-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted, #888);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition:
    background var(--duration-fast, 140ms) var(--ease-out, ease),
    color var(--duration-fast, 140ms) var(--ease-out, ease);
}

.customize-btn:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.07));
  color: var(--fg);
}

.customize-btn:focus-visible {
  outline: 1px solid var(--border-strong, rgba(128, 128, 128, 0.4));
  outline-offset: -1px;
}

.customize-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
