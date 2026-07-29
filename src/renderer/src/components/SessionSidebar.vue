<script setup lang="ts">
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
  NSpin,
  NText,
  NTooltip,
  useDialog,
  useMessage,
} from "naive-ui";
import {
  AddOutline,
  ChevronForwardOutline,
  CopyOutline,
  FolderOpenOutline,
  PinOutline,
  RefreshOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import PanelLeftIcon from "@renderer/components/icons/PanelLeftIcon.vue";
import Sortable from "sortablejs";
import { Splitpanes, Pane } from "splitpanes";
import type { SplitpanesResizedPayload } from "splitpanes";
import type { SessionStatus, SessionSummary } from "../../../shared/protocol";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useChatStore } from "@renderer/stores/chat";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import FilesTab from "@renderer/components/FilesTab.vue";
import { t } from "@renderer/i18n";

const PIN_KEY = "session-pins:v1";
const SESSION_ORDER_KEY = "pi-desktop:session-order:v1";

const layout = useLayoutStore();
const sessionsStore = useSessionsStore();
const chatStore = useChatStore();
const sendQueueStore = useSendQueueStore();
const workspace = useWorkspaceStore();
const dialog = useDialog();
const message = useMessage();

const sessionsByRoot = reactive<Record<string, SessionSummary[]>>({});
const expanded = reactive<Record<string, boolean>>({});
const pins = reactive<Record<string, string[]>>({});
const sessionOrders = reactive<Record<string, string[]>>({});
const sessionListEls = new Map<string, HTMLElement>();
const sessionSortables = new Map<string, Sortable>();

const renameOpen = ref(false);
const renameDraft = ref("");
const renameTarget = ref<{ root: string; id: string } | null>(null);

const workspacePaths = computed(() => {
  const paths = [...workspace.recent];
  // Safety: active root missing from list — append, never promote to front.
  if (
    workspace.root &&
    !paths.some((p) => p.toLowerCase() === workspace.root!.toLowerCase())
  ) {
    paths.push(workspace.root);
  }
  return paths;
});

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
    filter: ".session-list, .session-row, .trash",
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
    filter: ".empty-inline",
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
  loadPins();
  loadSessionOrders();
  sessionsStore.bindEvents();
  await workspace.getWorkspace();
  await workspace.listRecent();
  if (workspace.root && workspace.sessionsReady) {
    expanded[workspace.root] = true;
    await loadSessions(workspace.root);
    await ensureActiveSession(workspace.root);
  }
  void nextTick(() => bindWorkspaceSortable());
});

onUnmounted(() => {
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
    expanded[root] = true;
    await loadSessions(root);
    await ensureActiveSession(root);
  },
);

/** Merge live status into tree without wiping names / firstMessage. */
watch(
  () =>
    sessionsStore.sessions
      .map((s) => `${s.id}:${s.status}:${s.name ?? ""}:${s.modified}`)
      .join("|"),
  () => {
    const root = workspace.root;
    if (!root) return;
    const list = sessionsStore.sessions;
    const byId = new Map(list.map((s) => [s.id, s]));
    const current = sessionsByRoot[root] ?? [];
    if (!current.length) {
      sessionsByRoot[root] = list.map((s) => ({ ...s }));
      return;
    }
    // Update existing rows + append any new ones from the store
    const next = current.map((row) => {
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

function sessionsFor(root: string): SessionSummary[] {
  // Prefer live store for the active workspace so status dots update immediately
  const source =
    root === workspace.root && sessionsStore.sessions.length
      ? sessionsStore.sessions
      : (sessionsByRoot[root] ?? []);
  const list = [...source];
  const order = sessionOrders[root];
  if (order?.length) {
    const orderMap = new Map(order.map((id, i) => [id, i]));
    list.sort((a, b) => {
      const ai = orderMap.has(a.id) ? (orderMap.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
      const bi = orderMap.has(b.id) ? (orderMap.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      return b.modified.localeCompare(a.modified);
    });
    return list;
  }
  const pinned = new Set(pins[root] ?? []);
  list.sort((a, b) => {
    const ap = pinned.has(a.id) ? 0 : 1;
    const bp = pinned.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.modified.localeCompare(a.modified);
  });
  return list;
}

/** Freeze current visual order and append a new session id at the end. */
function appendSessionToOrder(root: string, sessionId: string): void {
  const base = sessionsFor(root)
    .map((s) => s.id)
    .filter((id) => id !== sessionId);
  sessionOrders[root] = [...base, sessionId];
  persistSessionOrders();
}

async function loadSessions(root: string): Promise<void> {
  const list = await window.api.sessions.list(root);
  sessionsByRoot[root] = list;
  if (root === workspace.root) sessionsStore.sessions = list;
}

async function ensureActiveSession(root: string): Promise<void> {
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
    await workspace.openWorkspacePath(path);
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
  if (workspace.trustDialogOpen || !workspace.sessionsReady) return;
  expanded[root] = true;
  const created = await sessionsStore.createSession(root);
  await loadSessions(root);
  if (created) {
    appendSessionToOrder(root, created.id);
    await onSelectSession(root, created.id);
  }
}

async function onAddWorkspace(): Promise<void> {
  const root = await workspace.openWorkspace();
  if (!root) return;
  expanded[root] = true;
  await loadSessions(root);
}

async function onSelectSession(root: string, sessionId: string): Promise<void> {
  chatStore.beginHistoryLoad(sessionId);
  try {
    if (workspace.root !== root) await workspace.openWorkspacePath(root);
    await sessionsStore.selectSession(sessionId, root);
    const opened =
      (sessionsByRoot[root] ?? []).find((s) => s.id === sessionId) ??
      sessionsStore.sessions.find((s) => s.id === sessionId);
    if (opened?.filePath) {
      const history = await window.api.sessions.history(opened.filePath);
      chatStore.hydrateFromHistory(sessionId, history);
    } else {
      chatStore.hydrateFromHistory(sessionId, []);
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
      const created = await sessionsStore.createSession(root);
      await loadSessions(root);
      if (created) {
        appendSessionToOrder(root, created.id);
        await onSelectSession(root, created.id);
      }
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
    case "remove": {
      const d = dialog.warning({
        title: t.removeWorkspaceTitle,
        content: t.removeWorkspaceConfirm(workspaceName(root)),
        positiveText: t.remove,
        negativeText: t.cancel,
        onPositiveClick: () => {
          d.loading = true;
          return (async () => {
            try {
              await workspace.removeRecent(root);
              delete sessionsByRoot[root];
              delete expanded[root];
              if (workspace.root) {
                expanded[workspace.root] = true;
                await loadSessions(workspace.root);
                await ensureActiveSession(workspace.root);
              } else {
                sessionsStore.activeId = null;
              }
            } catch (err) {
              message.error(err instanceof Error ? err.message : String(err));
              d.loading = false;
              return false;
            }
          })();
        },
      });
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

const sessionsPaneSize = computed(() => Math.max(22, 100 - layout.leftFilesSize));

function onLeftSplitResized(payload: SplitpanesResizedPayload): void {
  if (payload.panes.length < 2) return;
  const filesPane = payload.panes[1];
  if (filesPane?.size > 0) layout.setLeftFilesSize(filesPane.size);
}
</script>

<template>
  <aside class="sidebar">
    <div class="top-actions">
      <NButton
        secondary
        strong
        class="pi-interactive"
        style="flex: 1"
        :disabled="workspace.trustDialogOpen"
        @click="onNewAgent"
      >
        <template #icon>
          <NIcon :component="AddOutline" />
        </template>
        {{ t.newSessionAction }}
      </NButton>
      <NTooltip>
        <template #trigger>
          <NButton
            class="collapse-left-btn"
            quaternary
            circle
            @click="layout.toggleLeftCollapsed()"
          >
            <template #icon>
              <PanelLeftIcon :size="16" />
            </template>
          </NButton>
        </template>
        {{ t.collapseLeft }}
      </NTooltip>
    </div>

    <NAlert v-if="showStuckRecovery" type="warning" :bordered="false" style="margin: 0 8px 8px">
      {{ t.stuckBanner }}
      <template #footer>
        <NSpace>
          <NButton size="tiny" type="error" @click="onKill">{{ t.terminate }}</NButton>
          <NButton size="tiny" @click="onRestart">{{ t.restart }}</NButton>
        </NSpace>
      </template>
    </NAlert>

    <Splitpanes class="left-split" horizontal @resized="onLeftSplitResized">
      <Pane :size="sessionsPaneSize" :min-size="22">
        <div class="sessions-pane">
          <div class="section-head">
            <NText depth="3" style="font-size: 12px; font-weight: 600">{{ t.workspaces }}</NText>
            <NTooltip>
              <template #trigger>
                <NButton quaternary circle size="tiny" @click="onAddWorkspace">
                  <template #icon>
                    <NIcon :component="FolderOpenOutline" :size="14" />
                  </template>
                </NButton>
              </template>
              {{ t.addWorkspace }}
            </NTooltip>
          </div>

          <NScrollbar v-if="workspacePaths.length" class="tree">
            <div ref="workspaceTreeEl" class="ws-tree">
              <div
                v-for="root in workspacePaths"
                :key="root"
                class="ws-block"
                :data-root="root"
              >
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
                <NEllipsis style="font-weight: 600">{{ workspaceName(root) }}</NEllipsis>
              </button>

              <ul
                v-show="expanded[root]"
                class="session-list"
                :ref="(el) => setSessionListRef(root, el)"
              >
                <li v-if="!sessionsFor(root).length" class="empty-inline">{{ t.emptySessions }}</li>
                <li
                  v-for="session in sessionsFor(root)"
                  :key="session.id"
                  class="session-row"
                  :data-id="session.id"
                  :class="{ active: sessionsStore.activeId === session.id }"
                  @click="onSelectSession(root, session.id)"
                  @contextmenu="(e) => openSessionCtx(e, root, session)"
                >
                  <div class="session-inner">
                    <span class="active-bar" />
                    <span v-if="isRunning(session.status)" class="status-spin">
                      <NSpin :size="12" />
                    </span>
                    <span v-else :class="`dot dot-${session.status}`" />
                    <NIcon
                      v-if="isPinned(root, session.id)"
                      class="pin"
                      :component="PinOutline"
                      :size="12"
                    />
                    <span class="session-label">{{ sessionLabel(session) }}</span>
                    <span class="time">{{ relativeTime(session.modified) }}</span>
                    <NButton
                      class="trash"
                      quaternary
                      circle
                      size="tiny"
                      @click.stop="confirmDeleteSession(root, session.id)"
                    >
                      <template #icon>
                        <NIcon :component="TrashOutline" :size="14" />
                      </template>
                    </NButton>
                  </div>
                </li>
              </ul>
              </div>
            </div>
          </NScrollbar>
          <div v-else class="empty">{{ t.emptyWorkspaces }}</div>
        </div>
      </Pane>

      <Pane :size="layout.leftFilesSize" :min-size="22">
        <div class="files-pane">
          <FilesTab />
        </div>
      </Pane>
    </Splitpanes>

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

.left-split {
  flex: 1;
  min-height: 0;
}

.sessions-pane,
.files-pane {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.files-pane {
  border-top: none;
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

.collapse-left-btn:active {
  transform: none !important;
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

.left-split :deep(.splitpanes__splitter) {
  height: 4px !important;
  min-height: 4px !important;
  background: var(--border) !important;
  cursor: row-resize;
}

.left-split :deep(.splitpanes__splitter:hover) {
  background: var(--accent-border, #93c5fd) !important;
}

.ws-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm, 7px);
  background: transparent;
  color: var(--fg-strong);
  font-size: 13px;
  text-align: left;
  cursor: grab;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.ws-row:active {
  cursor: grabbing;
}

.ws-row:hover,
.ws-row.active {
  background: var(--bg-hover);
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
  margin: 0 0 6px;
  padding: 0;
}

.session-row {
  position: relative;
  list-style: none;
  margin: 0;
  padding: 0;
  border-radius: var(--radius-sm, 7px);
  font-size: 13px;
  color: var(--fg-muted);
  cursor: pointer;
}

.session-inner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 8px 4px 22px;
  border-radius: var(--radius-sm, 7px);
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease), color var(--duration-fast, 140ms) var(--ease-out, ease);
}

.session-row:hover .session-inner {
  background: var(--bg-hover);
  color: var(--fg);
}

.session-row.active .session-inner {
  background: var(--bg-selected);
  color: var(--fg-strong);
}

.active-bar {
  position: absolute;
  left: 6px;
  top: 8px;
  bottom: 8px;
  width: 3px;
  border-radius: 2px;
  background: transparent;
}

.session-row.active .active-bar {
  background: var(--accent);
}

.session-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.time {
  font-size: 11px;
  color: var(--fg-faint);
}

.trash {
  opacity: 0;
}

.session-row:hover .trash {
  opacity: 1;
}

.pin {
  flex-shrink: 0;
  color: var(--accent);
}

.status-spin {
  width: 6px;
  height: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: transparent;
  flex-shrink: 0;
}

.dot-running {
  background: var(--green);
}
.dot-error {
  background: var(--red);
}
.dot-stuck {
  background: #ca8a04;
}

.empty,
.empty-inline {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--fg-faint);
}
</style>
