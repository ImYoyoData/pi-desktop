<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const props = defineProps<{
  /** Unique id for this terminal pane (dynamic right tab) */
  instanceId?: string;
  /** Tab is visible — refit when shown so height matches the pane */
  visible?: boolean;
}>();

const workspace = useWorkspaceStore();
const hostRef = ref<HTMLDivElement | null>(null);
const ready = ref(false);

let term: Terminal | null = null;
let fit: FitAddon | null = null;
let ptyId: string | null = null;
let resizeObserver: ResizeObserver | null = null;
let offData: (() => void) | null = null;
let fitRaf = 0;

function fitTerm(): void {
  if (!term || !fit || !ptyId || !hostRef.value) return;
  if (props.visible === false) return;
  const rect = hostRef.value.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  try {
    fit.fit();
    const { cols, rows } = term;
    void window.api.terminal.resize(ptyId, cols, rows);
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

async function start(): Promise<void> {
  const cwd = workspace.root;
  if (!cwd || !hostRef.value || ptyId) return;

  ptyId = await window.api.terminal.create(cwd);
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "Cascadia Code, Consolas, Menlo, monospace",
    theme: {
      background: "#ffffff",
      foreground: "#1a1a1a",
      cursor: "#1a1a1a",
      selectionBackground: "rgba(37, 99, 235, 0.25)",
    },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(hostRef.value);
  term.onData((data) => {
    if (ptyId) void window.api.terminal.write(ptyId, data);
  });

  await nextTick();
  scheduleFit();
  term.focus();
  ready.value = true;
}

async function stop(): Promise<void> {
  if (ptyId) {
    await window.api.terminal.dispose(ptyId);
    ptyId = null;
  }
  term?.dispose();
  term = null;
  fit = null;
  ready.value = false;
}

watch(
  () => workspace.root,
  async (root, prev) => {
    if (!root || root === prev) return;
    await stop();
    await start();
  },
);

watch(
  () => props.visible,
  (v) => {
    if (v) scheduleFit();
  },
);

onMounted(async () => {
  offData = window.api.terminal.onData(({ id, data }) => {
    if (id === ptyId) term?.write(data);
  });
  resizeObserver = new ResizeObserver(() => scheduleFit());
  if (hostRef.value) resizeObserver.observe(hostRef.value);
  await workspace.getWorkspace();
  if (workspace.root) await start();
});

onBeforeUnmount(async () => {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  offData?.();
  resizeObserver?.disconnect();
  await stop();
});

void props.instanceId;
</script>

<template>
  <div class="terminal-tab">
    <div v-if="!workspace.root" class="empty">{{ t.terminalEmpty }}</div>
    <div v-else ref="hostRef" class="term-host" />
  </div>
</template>

<style scoped>
.terminal-tab {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: #fff;
}

.term-host {
  flex: 1 1 auto;
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
}

.term-host :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--fg-faint);
}
</style>
