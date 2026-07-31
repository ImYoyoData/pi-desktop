<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { NButton, NEmpty, useDialog, useMessage } from "naive-ui";
import { t } from "@renderer/i18n";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useSessionsStore } from "@renderer/stores/sessions";
import { handleAppLinkClick } from "@renderer/utils/open-link";
import { xtermTheme } from "@renderer/utils/xterm-theme";

const props = defineProps<{
  /** Tab is visible — refit when shown so height matches the pane */
  visible?: boolean;
}>();

const store = useAgentRunsStore();
const { selectedId, runs } = storeToRefs(store);
const sessions = useSessionsStore();
const appearance = useAppearanceStore();
const message = useMessage();
const dialog = useDialog();

const now = ref(Date.now());
const hostRef = ref<HTMLDivElement | null>(null);
let tickTimer: ReturnType<typeof setInterval> | null = null;

let term: Terminal | null = null;
let fit: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let fitRaf = 0;
let writeBuf = "";
let writeRaf = 0;
/** Last run id + tail successfully pushed to xterm (for incremental writes). */
let syncedRunId: string | null = null;
let lastWrittenTail = "";
/**
 * xterm parses synchronously — one giant write freezes the renderer (and with
 * it the whole window) for seconds. Cap the pending buffer (keep newest) and
 * write at most one frame's worth per animation frame.
 */
const MAX_WRITE_BUF = 512 * 1024;
const WRITE_PER_FRAME = 64 * 1024;

const selectedRun = computed(() => {
  const id = selectedId.value;
  if (!id) return null;
  return runs.value.find((r) => r.id === id) ?? null;
});

const selectedOutputTail = computed(() => selectedRun.value?.outputTail ?? "");

function flushWriteBuf(): void {
  writeRaf = 0;
  if (!term || !writeBuf) return;
  const chunk = writeBuf.slice(0, WRITE_PER_FRAME);
  writeBuf = writeBuf.slice(WRITE_PER_FRAME);
  term.write(chunk, () => {
    term?.scrollToBottom();
  });
  // Spread large dumps over multiple frames so the renderer never stalls.
  if (writeBuf) {
    writeRaf = requestAnimationFrame(flushWriteBuf);
  }
}

function enqueueWrite(data: string): void {
  if (!data) return;
  writeBuf += data;
  if (writeBuf.length > MAX_WRITE_BUF) {
    // Keep the newest data (what the user sees) — drop the middle.
    writeBuf = writeBuf.slice(writeBuf.length - MAX_WRITE_BUF);
  }
  if (writeRaf) return;
  writeRaf = requestAnimationFrame(flushWriteBuf);
}

function fitTerm(): void {
  if (!term || !fit || !hostRef.value) return;
  if (props.visible === false) return;
  const rect = hostRef.value.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  try {
    fit.fit();
    // After display:none → visible, force a full cell redraw so prior writes show up.
    if (term.rows > 0) {
      term.refresh(0, term.rows - 1);
    }
    term.scrollToBottom();
  } catch {
    // container may not be laid out yet
  }
}

function scheduleFit(): void {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(() => {
    fitRaf = requestAnimationFrame(() => {
      fitTerm();
    });
  });
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (!term || !term.hasSelection()) return;
  const text = term.getSelection();
  term.clearSelection();
  if (text) {
    void navigator.clipboard.writeText(text).catch(() => {
      // ignore clipboard write failures
    });
  }
}

function resetSync(): void {
  syncedRunId = null;
  lastWrittenTail = "";
  writeBuf = "";
  if (writeRaf) {
    cancelAnimationFrame(writeRaf);
    writeRaf = 0;
  }
}

function syncOutput(forceFull = false): void {
  if (!term) return;
  const run = selectedRun.value;
  if (!run) {
    if (syncedRunId !== null || lastWrittenTail) {
      term.reset();
      resetSync();
    }
    return;
  }
  const tail = run.outputTail ?? "";
  const mustFull = forceFull || run.id !== syncedRunId;
  if (mustFull) {
    term.reset();
    writeBuf = "";
    if (writeRaf) {
      cancelAnimationFrame(writeRaf);
      writeRaf = 0;
    }
    enqueueWrite(tail);
    syncedRunId = run.id;
    lastWrittenTail = tail;
    return;
  }
  if (tail === lastWrittenTail) return;
  if (tail.startsWith(lastWrittenTail)) {
    enqueueWrite(tail.slice(lastWrittenTail.length));
    lastWrittenTail = tail;
    return;
  }
  // Ring buffer capped from the front — full rewrite.
  term.reset();
  writeBuf = "";
  if (writeRaf) {
    cancelAnimationFrame(writeRaf);
    writeRaf = 0;
  }
  enqueueWrite(tail);
  lastWrittenTail = tail;
}

function bindXterm(host: HTMLDivElement): void {
  term = new Terminal({
    disableStdin: true,
    convertEol: true,
    cursorBlink: false,
    cursorInactiveStyle: "none",
    fontSize: 13,
    fontFamily: "Cascadia Code, Consolas, Menlo, monospace",
    rightClickSelectsWord: false,
    scrollback: 5000,
    theme: xtermTheme(appearance.resolvedTheme === "dark"),
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      handleAppLinkClick(event, uri, dialog);
    }),
  );
  term.open(host);
  host.addEventListener("contextmenu", onContextMenu, true);
}

onMounted(() => {
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, 1000);

  const host = hostRef.value;
  if (host) {
    bindXterm(host);
    resizeObserver = new ResizeObserver(() => scheduleFit());
    resizeObserver.observe(host);
    syncOutput(true);
    void nextTick(() => scheduleFit());
  }
});

onBeforeUnmount(() => {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (fitRaf) cancelAnimationFrame(fitRaf);
  if (writeRaf) cancelAnimationFrame(writeRaf);
  hostRef.value?.removeEventListener("contextmenu", onContextMenu, true);
  resizeObserver?.disconnect();
  resizeObserver = null;
  term?.dispose();
  term = null;
  fit = null;
  resetSync();
});

// Selection change → full redraw; output growth → incremental append.
watch(selectedId, () => {
  syncOutput(true);
  if (props.visible !== false) scheduleFit();
});

watch(selectedOutputTail, () => {
  syncOutput(false);
});

watch(
  () => props.visible,
  (v) => {
    if (!v || !term) return;
    term.options.theme = xtermTheme(appearance.resolvedTheme === "dark");
    // Parent was display:none — rewrite + fit so the live buffer is actually painted.
    syncOutput(true);
    void nextTick(() => scheduleFit());
  },
);

watch(
  () => appearance.resolvedTheme,
  () => {
    if (!term || props.visible === false) return;
    term.options.theme = xtermTheme(appearance.resolvedTheme === "dark");
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
            <span v-if="run.detached" class="status"> · {{ t.runningDetached }}</span>
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
    <div class="run-out">
      <div ref="hostRef" class="term-host" />
      <div v-if="!selectedRun" class="out-empty">
        <NEmpty :description="t.runningSelectHint" size="small" />
      </div>
    </div>
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
  position: relative;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-elevated);
}

.term-host {
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  box-sizing: border-box;
}

.term-host :deep(.xterm) {
  width: 100%;
  height: 100%;
  padding: 4px;
  box-sizing: border-box;
  color: var(--fg-strong, #27272a);
}

.term-host :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.term-host :deep(.xterm-helper-textarea),
.term-host :deep(.xterm-composition-view) {
  color: var(--fg-strong, #27272a) !important;
  caret-color: transparent !important;
}

.out-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 12px;
  background: var(--bg-elevated);
  z-index: 1;
}
</style>
