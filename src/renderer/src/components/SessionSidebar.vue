<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import type { SessionStatus } from "../../../shared/protocol";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";

const layout = useLayoutStore();
const sessionsStore = useSessionsStore();
const workspace = useWorkspaceStore();

const hasWorkspace = computed(() => Boolean(workspace.root));

const activeSession = computed(() =>
  sessionsStore.activeId
    ? sessionsStore.sessions.find((s) => s.id === sessionsStore.activeId) ?? null
    : null,
);

const showStuckRecovery = computed(() => activeSession.value?.status === "stuck");

onMounted(async () => {
  sessionsStore.bindEvents();
  await workspace.getWorkspace();
  await sessionsStore.refresh(workspace.root);
});

watch(
  () => workspace.root,
  async (root) => {
    sessionsStore.activeId = null;
    await sessionsStore.refresh(root);
  },
);

async function onNewSession(): Promise<void> {
  if (!workspace.root) {
    return;
  }
  await sessionsStore.createSession(workspace.root);
  await sessionsStore.refresh(workspace.root);
}

async function onKill(): Promise<void> {
  if (!sessionsStore.activeId) {
    return;
  }
  await sessionsStore.killWorker(sessionsStore.activeId, workspace.root);
}

async function onRestart(): Promise<void> {
  if (!sessionsStore.activeId) {
    return;
  }
  await sessionsStore.restartWorker(sessionsStore.activeId, workspace.root);
}

async function onPing(): Promise<void> {
  if (!sessionsStore.activeId) {
    return;
  }
  await sessionsStore.sendCommand(sessionsStore.activeId, { type: "ping" });
}

async function onHang(): Promise<void> {
  if (!sessionsStore.activeId) {
    return;
  }
  void sessionsStore.sendCommand(sessionsStore.activeId, { type: "hang" });
}

async function onSelectSession(sessionId: string): Promise<void> {
  if (!workspace.root) {
    return;
  }
  await sessionsStore.selectSession(sessionId, workspace.root);
}

function sessionLabel(session: { name?: string; firstMessage?: string; id: string }): string {
  if (session.name?.trim()) {
    return session.name.trim();
  }
  if (session.firstMessage?.trim() && session.firstMessage !== "(no messages)") {
    const text = session.firstMessage.trim();
    return text.length > 48 ? `${text.slice(0, 45)}…` : text;
  }
  return session.id.slice(0, 8);
}

function statusClass(status: SessionStatus): string {
  return `dot dot-${status}`;
}
</script>

<template>
  <aside class="session-sidebar">
    <header class="head">
      <span class="title">Sessions</span>
      <button type="button" class="collapse" title="Collapse sidebar" @click="layout.toggleLeftCollapsed()">
        &lsaquo;
      </button>
    </header>

    <div v-if="showStuckRecovery" class="stuck-banner">
      <p class="stuck-text">Worker not responding. Terminate or restart this session only.</p>
      <div class="stuck-actions">
        <button type="button" class="btn danger" @click="onKill">Terminate</button>
        <button type="button" class="btn" @click="onRestart">Restart</button>
      </div>
    </div>

    <div class="toolbar">
      <button type="button" class="btn" :disabled="!hasWorkspace" @click="onNewSession">New</button>
      <button type="button" class="btn" :disabled="!sessionsStore.activeId" @click="onKill">
        Terminate
      </button>
      <button type="button" class="btn" :disabled="!sessionsStore.activeId" @click="onRestart">
        Restart
      </button>
      <button type="button" class="btn" :disabled="!sessionsStore.activeId" @click="onPing">Ping</button>
      <button type="button" class="btn warn" :disabled="!sessionsStore.activeId" @click="onHang">Hang</button>
    </div>

    <p v-if="!hasWorkspace" class="hint">Open a workspace folder to list or create sessions.</p>

    <ul class="list">
      <li
        v-for="session in sessionsStore.sessions"
        :key="session.id"
        class="row"
        :class="{ active: session.id === sessionsStore.activeId }"
        @click="onSelectSession(session.id)"
      >
        <span :class="statusClass(session.status)" :title="session.status" />
        <span class="label">{{ sessionLabel(session) }}</span>
        <span class="meta">{{ session.status }}</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.session-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: #f9fafb;
  border-right: 1px solid #e5e7eb;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
  font-size: 0.8125rem;
  font-weight: 600;
}

.collapse {
  padding: 0.15rem 0.45rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  line-height: 1;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e5e7eb;
}

.hint {
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-size: 0.75rem;
  color: #6b7280;
}

.btn {
  font-size: 0.75rem;
  padding: 0.2rem 0.45rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.warn {
  border-color: #fbbf24;
}

.stuck-banner {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #fcd34d;
  background: #fffbeb;
}

.stuck-text {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  color: #92400e;
}

.stuck-actions {
  display: flex;
  gap: 0.35rem;
}

.btn.danger {
  border-color: #f87171;
  color: #b91c1c;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0.35rem 0;
  overflow: auto;
  flex: 1;
}

.row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.5rem;
  align-items: center;
  padding: 0.35rem 0.75rem;
  cursor: pointer;
  font-size: 0.8125rem;
}

.row:hover {
  background: #f3f4f6;
}

.row.active {
  background: #e5e7eb;
}

.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 999px;
  background: #9ca3af;
}

.dot-idle {
  background: #9ca3af;
}

.dot-running {
  background: #22c55e;
}

.dot-error {
  background: #ef4444;
}

.dot-stuck {
  background: #f59e0b;
}

.label {
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
}

.meta {
  font-size: 0.6875rem;
  color: #6b7280;
  text-transform: capitalize;
}
</style>
