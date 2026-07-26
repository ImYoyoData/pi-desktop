<script setup lang="ts">
import { onMounted } from "vue";
import type { SessionStatus } from "../../../shared/protocol";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useWorkspaceStore } from "@renderer/stores/workspace";

const layout = useLayoutStore();
const sessionsStore = useSessionsStore();
const workspace = useWorkspaceStore();

onMounted(async () => {
  sessionsStore.bindEvents();
  await workspace.getWorkspace();
  await sessionsStore.refresh();
});

async function onNewSession(): Promise<void> {
  const cwd = workspace.root ?? ".";
  await sessionsStore.createSession(cwd);
}

async function onKill(): Promise<void> {
  if (!sessionsStore.activeId) {
    return;
  }
  await sessionsStore.killWorker(sessionsStore.activeId);
}

async function onRestart(): Promise<void> {
  if (!sessionsStore.activeId) {
    return;
  }
  await sessionsStore.restartWorker(sessionsStore.activeId);
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

    <div class="toolbar">
      <button type="button" class="btn" @click="onNewSession">New</button>
      <button type="button" class="btn" :disabled="!sessionsStore.activeId" @click="onKill">Kill</button>
      <button type="button" class="btn" :disabled="!sessionsStore.activeId" @click="onRestart">Restart</button>
      <button type="button" class="btn" :disabled="!sessionsStore.activeId" @click="onPing">Ping</button>
      <button type="button" class="btn warn" :disabled="!sessionsStore.activeId" @click="onHang">Hang</button>
    </div>

    <ul class="list">
      <li
        v-for="session in sessionsStore.sessions"
        :key="session.id"
        class="row"
        :class="{ active: session.id === sessionsStore.activeId }"
        @click="sessionsStore.selectSession(session.id)"
      >
        <span :class="statusClass(session.status)" :title="session.status" />
        <span class="label">{{ session.id.slice(0, 8) }}</span>
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
