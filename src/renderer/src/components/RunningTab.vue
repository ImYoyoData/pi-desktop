<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { NButton, NEmpty, useMessage } from "naive-ui";
import { t } from "@renderer/i18n";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useSessionsStore } from "@renderer/stores/sessions";

const store = useAgentRunsStore();
const sessions = useSessionsStore();
const message = useMessage();

const now = ref(Date.now());
const outEl = ref<HTMLPreElement | null>(null);
let tickTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
});

watch(
  () => store.selected?.outputTail?.length ?? 0,
  async () => {
    await nextTick();
    const el = outEl.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  },
);

function truncate(cmd: string, max = 72): string {
  const oneLine = cmd.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

function sessionLabel(sessionId: string): string {
  const name = sessions.sessions.find((s) => s.id === sessionId)?.name?.trim();
  if (name) return name;
  return sessionId.slice(0, 8);
}

function elapsed(startedAt: number): string {
  const secs = Math.max(0, Math.floor((now.value - startedAt) / 1000));
  return t.runningElapsed(secs);
}

async function onTerminate(runId: string): Promise<void> {
  try {
    await store.terminate(runId);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t.runningTerminateFailed);
  }
}

function onRowKeydown(e: KeyboardEvent, runId: string): void {
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  store.select(runId);
}
</script>

<template>
  <div class="running-tab">
    <aside class="run-list">
      <div v-if="!store.runs.length" class="empty-wrap">
        <NEmpty :description="t.runningEmpty" size="small" />
      </div>
      <div
        v-for="run in store.runs"
        :key="run.id"
        role="button"
        tabindex="0"
        class="run-row"
        :class="{ active: run.id === store.selectedId }"
        @click="store.select(run.id)"
        @keydown="onRowKeydown($event, run.id)"
      >
        <div class="run-main">
          <div class="cmd" :title="run.command">{{ truncate(run.command) }}</div>
          <div class="meta">
            {{ sessionLabel(run.sessionId) }} · {{ elapsed(run.startedAt) }}
            <span v-if="run.status === 'terminating'" class="status"> · …</span>
          </div>
        </div>
        <NButton
          size="tiny"
          :disabled="run.status === 'terminating'"
          @click.stop="onTerminate(run.id)"
        >
          {{ t.runningTerminate }}
        </NButton>
      </div>
    </aside>
    <pre ref="outEl" class="run-out">{{ store.selected?.outputTail ?? "" }}</pre>
  </div>
</template>

<style scoped>
.running-tab {
  display: grid;
  grid-template-columns: minmax(160px, 38%) 1fr;
  height: 100%;
  min-height: 0;
}

.run-list {
  border-right: 1px solid var(--border);
  overflow: auto;
  min-height: 0;
}

.empty-wrap {
  height: 100%;
  display: grid;
  place-items: center;
  padding: 12px;
}

.run-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  padding: 8px;
  cursor: pointer;
  color: var(--fg);
}

.run-row:hover {
  background: var(--bg-hover);
}

.run-row.active {
  background: var(--bg-panel);
}

.run-main {
  flex: 1;
  min-width: 0;
}

.cmd {
  font-size: 12px;
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--fg-muted);
}

.status {
  color: var(--fg-faint);
}

.run-out {
  margin: 0;
  padding: 8px 10px;
  overflow: auto;
  min-height: 0;
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg);
  background: color-mix(in srgb, var(--bg) 92%, var(--bg-elevated));
}
</style>
