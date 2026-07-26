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
}>();

const workspace = useWorkspaceStore();
const hostRef = ref<HTMLDivElement | null>(null);
const ready = ref(false);

let term: Terminal | null = null;
let fit: FitAddon | null = null;
let ptyId: string | null = null;
let resizeObserver: ResizeObserver | null = null;
let offData: (() => void) | null = null;

function fitTerm(): void {
  if (!term || !fit || !ptyId) return;
  fit.fit();
  const { cols, rows } = term;
  void window.api.terminal.resize(ptyId, cols, rows);
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
  fitTerm();
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

onMounted(async () => {
  offData = window.api.terminal.onData(({ id, data }) => {
    if (id === ptyId) term?.write(data);
  });
  resizeObserver = new ResizeObserver(() => fitTerm());
  if (hostRef.value) resizeObserver.observe(hostRef.value);
  await workspace.getWorkspace();
  if (workspace.root) await start();
});

onBeforeUnmount(async () => {
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
  height: 100%;
  min-height: 0;
  background: #fff;
}

.term-host {
  flex: 1;
  min-height: 0;
  padding: 4px;
}

.term-host :deep(.xterm) {
  height: 100%;
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
