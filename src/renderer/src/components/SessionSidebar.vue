<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch } from "vue";
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
  ChevronBackOutline,
  ChevronForwardOutline,
  CopyOutline,
  FolderOpenOutline,
  PinOutline,
  RefreshOutline,
  TrashOutline,
} from "@vicons/ionicons5";
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

const renameOpen = ref(false);
const renameDraft = ref("");
const renameTarget = ref<{ root: string; id: string } | null>(null);

const workspacePaths = computed(() => {
  const paths = [...workspace.recent];
  if (workspace.root && !paths.includes(workspace.root)) {
    paths.unshift(workspace.root);
  }
  return paths;
});

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
  sessionsStore.bindEvents();
  await workspace.getWorkspace();
  await workspace.listRecent();
  if (workspace.root) {
    expanded[workspace.root] = true;
    await loadSessions(workspace.root);
    await ensureActiveSession(workspace.root);
  }
});

watch(
  () => workspace.root,
  async (root) => {
    if (!root) return;
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
  const pinned = new Set(pins[root] ?? []);
  list.sort((a, b) => {
    const ap = pinned.has(a.id) ? 0 : 1;
    const bp = pinned.has(b.id) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return b.modified.localeCompare(a.modified);
  });
  return list;
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
  let root = workspace.root;
  if (!root) root = await workspace.openWorkspace();
  if (!root) return;
  expanded[root] = true;
  const created = await sessionsStore.createSession(root);
  await loadSessions(root);
  if (created) await onSelectSession(root, created.id);
}

async function onAddWorkspace(): Promise<void> {
  const root = await workspace.openWorkspace();
  if (!root) return;
  expanded[root] = true;
  await loadSessions(root);
}

async function onSelectSession(root: string, sessionId: string): Promise<void> {
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
  dialog.warning({
    title: t.deleteSession,
    content: t.deleteConfirm(label),
    positiveText: t.delete,
    negativeText: t.cancel,
    onPositiveClick: async () => {
      if (workspace.root !== root) await workspace.openWorkspacePath(root);
      await sessionsStore.deleteSession(sessionId, root);
      chatStore.clearSession(sessionId);
      sendQueueStore.clearSession(sessionId);
      pins[root] = (pins[root] ?? []).filter((id) => id !== sessionId);
      persistPins();
      await loadSessions(root);
      await ensureActiveSession(root);
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
      if (workspace.root !== root) await workspace.openWorkspacePath(root);
      expanded[root] = true;
      const created = await sessionsStore.createSession(root);
      await loadSessions(root);
      if (created) await onSelectSession(root, created.id);
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
    case "remove":
      dialog.warning({
        title: t.removeWorkspaceTitle,
        content: t.removeWorkspaceConfirm(workspaceName(root)),
        positiveText: t.remove,
        negativeText: t.cancel,
        onPositiveClick: async () => {
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
        },
      });
      break;
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
      <NButton secondary strong style="flex: 1" @click="onNewAgent">
        <template #icon>
          <NIcon :component="AddOutline" />
        </template>
        {{ t.newSessionAction }}
      </NButton>
      <NTooltip>
        <template #trigger>
          <NButton quaternary circle @click="layout.toggleLeftCollapsed()">
            <template #icon>
              <NIcon :component="ChevronBackOutline" :size="18" />
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
            <div v-for="root in workspacePaths" :key="root" class="ws-block">
              <NDropdown
                trigger="contextmenu"
                :options="workspaceMenuOptions()"
                @select="(key) => onWorkspaceMenu(root, key)"
              >
                <button
                  type="button"
                  class="ws-row"
                  :class="{ active: workspace.root === root && !sessionsStore.activeId }"
                  :title="root"
                  @click="onWorkspaceClick(root)"
                >
                  <span class="chevron" :class="{ open: expanded[root] }">
                    <NIcon :component="ChevronForwardOutline" :size="14" />
                  </span>
                  <NEllipsis style="font-weight: 600">{{ workspaceName(root) }}</NEllipsis>
                </button>
              </NDropdown>

              <ul v-show="expanded[root]" class="session-list">
                <li v-if="!sessionsFor(root).length" class="empty-inline">{{ t.emptySessions }}</li>
                <li
                  v-for="session in sessionsFor(root)"
                  :key="session.id"
                  class="session-row"
                  :class="{ active: sessionsStore.activeId === session.id }"
                  @click="onSelectSession(root, session.id)"
                  @contextmenu.prevent
                >
                  <NDropdown
                    trigger="contextmenu"
                    :options="sessionMenu(root, session)"
                    @select="(key) => onSessionMenu(root, session, key)"
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
                  </NDropdown>
                </li>
              </ul>
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
  border-radius: 6px;
  background: transparent;
  color: var(--fg-strong);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.ws-row:hover,
.ws-row.active {
  background: var(--bg-hover);
}

.chevron {
  display: inline-flex;
  color: var(--fg-faint);
  transition: transform 0.12s ease;
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
  border-radius: 6px;
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
  border-radius: 6px;
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
