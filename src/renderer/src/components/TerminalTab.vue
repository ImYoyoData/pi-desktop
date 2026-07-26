<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";

type TermSession = {
  id: string;
  label: string;
  term: Terminal;
  fit: FitAddon;
  container: HTMLDivElement;
};

const workspace = useWorkspaceStore();
const sessions = ref<TermSession[]>([]);
const activeId = ref<string | null>(null);
const hostRef = ref<HTMLDivElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let offData: (() => void) | null = null;

function fitActive(): void {
  const session = sessions.value.find((s) => s.id === activeId.value);
  if (!session) {
    return;
  }
  session.fit.fit();
  const { cols, rows } = session.term;
  void window.api.terminal.resize(session.id, cols, rows);
}

async function addTab(): Promise<void> {
  const cwd = workspace.root;
  if (!cwd) {
    return;
  }
  const id = await window.api.terminal.create(cwd);
  const container = document.createElement("div");
  container.className = "term-viewport";
  container.style.display = "none";

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "Consolas, Menlo, monospace",
    theme: { background: "#111827", foreground: "#f3f4f6" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);
  term.onData((data) => {
    void window.api.terminal.write(id, data);
  });

  const label = `Terminal ${sessions.value.length + 1}`;
  sessions.value.push({ id, label, term, fit, container });
  activeId.value = id;

  await nextTick();
  if (hostRef.value) {
    hostRef.value.appendChild(container);
  }
  showOnly(id);
  fitActive();
  term.focus();
}

function showOnly(id: string): void {
  for (const session of sessions.value) {
    const visible = session.id === id;
    session.container.style.display = visible ? "block" : "none";
    if (visible) {
      session.fit.fit();
    }
  }
}

async function closeTab(id: string): Promise<void> {
  const index = sessions.value.findIndex((s) => s.id === id);
  if (index === -1) {
    return;
  }
  const [session] = sessions.value.splice(index, 1);
  await window.api.terminal.dispose(id);
  session.term.dispose();
  session.container.remove();

  if (activeId.value === id) {
    const next = sessions.value[index] ?? sessions.value[index - 1];
    activeId.value = next?.id ?? null;
    if (next) {
      showOnly(next.id);
      next.term.focus();
      fitActive();
    }
  }
}

watch(activeId, (id) => {
  if (!id) {
    return;
  }
  showOnly(id);
  void nextTick(() => {
    fitActive();
    sessions.value.find((s) => s.id === id)?.term.focus();
  });
});

watch(
  () => workspace.root,
  async (root, prev) => {
    if (!root || root === prev) {
      return;
    }
    for (const session of [...sessions.value]) {
      await closeTab(session.id);
    }
    await addTab();
  },
);

onMounted(async () => {
  offData = window.api.terminal.onData(({ id, data }) => {
    const session = sessions.value.find((s) => s.id === id);
    session?.term.write(data);
  });

  resizeObserver = new ResizeObserver(() => {
    fitActive();
  });
  if (hostRef.value) {
    resizeObserver.observe(hostRef.value);
  }

  await workspace.getWorkspace();
  if (workspace.root) {
    await addTab();
  }
});

onBeforeUnmount(async () => {
  offData?.();
  resizeObserver?.disconnect();
  for (const session of [...sessions.value]) {
    await window.api.terminal.dispose(session.id);
    session.term.dispose();
    session.container.remove();
  }
  sessions.value = [];
});
</script>

<template>
  <div class="terminal-tab">
    <header class="term-bar">
      <div class="term-tabs">
        <button
          v-for="session in sessions"
          :key="session.id"
          type="button"
          class="term-tab"
          :class="{ active: activeId === session.id }"
          @click="activeId = session.id"
        >
          <span>{{ session.label }}</span>
          <span
            class="close"
            title="Close"
            @click.stop="closeTab(session.id)"
          >&times;</span>
        </button>
      </div>
      <button type="button" class="new-tab" title="New terminal" @click="addTab">+</button>
    </header>
    <div v-if="!workspace.root" class="empty">Open a workspace to use the terminal.</div>
    <div v-else ref="hostRef" class="term-host" />
  </div>
</template>

<style scoped>
.terminal-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: #111827;
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.35rem;
  background: #1f2937;
  border-bottom: 1px solid #374151;
}

.term-tabs {
  display: flex;
  flex: 1;
  gap: 0.25rem;
  min-width: 0;
  overflow-x: auto;
}

.term-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.45rem;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #d1d5db;
  font-size: 0.6875rem;
  cursor: pointer;
  white-space: nowrap;
}

.term-tab.active {
  background: #374151;
  color: #f9fafb;
}

.close {
  font-size: 0.875rem;
  line-height: 1;
  opacity: 0.7;
}

.close:hover {
  opacity: 1;
}

.new-tab {
  padding: 0.15rem 0.5rem;
  border: 1px solid #4b5563;
  border-radius: 4px;
  background: #111827;
  color: #e5e7eb;
  cursor: pointer;
  line-height: 1.2;
}

.term-host {
  flex: 1;
  min-height: 0;
  padding: 0.25rem;
}

.term-host :deep(.term-viewport) {
  height: 100%;
  width: 100%;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8125rem;
  color: #9ca3af;
}
</style>
