<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";
import { WebLinksAddon } from "xterm-addon-web-links";
import "xterm/css/xterm.css";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useDialog } from "naive-ui";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { sanitizeTerminalCommandLabel, truncateTabLabel } from "../../../shared/tab-label";
import { t } from "@renderer/i18n";
import { handleAppLinkClick } from "@renderer/utils/open-link";
import { xtermTheme } from "@renderer/utils/xterm-theme";

const props = defineProps<{
  /** Unique id for this terminal pane (dynamic right tab) */
  instanceId?: string;
  /** Tab is visible — refit when shown so height matches the pane */
  visible?: boolean;
  /** Existing pty to re-attach (kept alive across workspace switches). */
  ptyId?: string | null;
  /** Cwd used when the pty was created. */
  cwd?: string | null;
}>();

const workspace = useWorkspaceStore();
const appearance = useAppearanceStore();
const rightTabs = useRightTabsStore();
const dialog = useDialog();
const hostRef = ref<HTMLDivElement | null>(null);
const ready = ref(false);
const activePtyId = ref<string | null>(null);

let term: Terminal | null = null;
let fit: FitAddon | null = null;
let resizeObserver: ResizeObserver | null = null;
let offData: (() => void) | null = null;
let fitRaf = 0;
/** Renderer-side coalesce — xterm.write is expensive under flood. */
let writeBuf = "";
let writeRaf = 0;
/**
 * xterm parses synchronously — one giant write freezes the renderer (and with
 * it the whole window) for seconds. Cap the pending buffer (keep newest) and
 * write at most one frame's worth per animation frame.
 */
const MAX_WRITE_BUF = 512 * 1024;
const WRITE_PER_FRAME = 64 * 1024;
/** First Enter-submitted command → auto tab title (once). */
let inputLineBuf = "";
let autoTitled = false;
/** Skip CSI / OSC sequences in onData so focus-in `[I` never enters the title buffer. */
let ansiSkip: "none" | "esc" | "csi" | "osc" = "none";

function flushWriteBuf(): void {
  writeRaf = 0;
  if (!term || !writeBuf) return;
  const chunk = writeBuf.slice(0, WRITE_PER_FRAME);
  writeBuf = writeBuf.slice(WRITE_PER_FRAME);
  term.write(chunk);
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
  if (!term || !fit || !activePtyId.value || !hostRef.value) return;
  if (props.visible === false) return;
  const rect = hostRef.value.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return;
  try {
    fit.fit();
    const { cols, rows } = term;
    void window.api.terminal.resize(activePtyId.value, cols, rows);
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
  if (!term) return;

  if (term.hasSelection()) {
    const text = term.getSelection();
    term.clearSelection();
    if (text) {
      void navigator.clipboard.writeText(text).catch(() => {
        // ignore clipboard write failures
      });
    }
    term.focus();
    return;
  }

  void navigator.clipboard
    .readText()
    .then((text) => {
      if (text && term) term.paste(text);
    })
    .catch(() => {
      // ignore clipboard read failures (permission / empty)
    });
  term.focus();
}

function noteUserInput(data: string): void {
  if (autoTitled || !props.instanceId) return;
  for (const ch of data) {
    if (ansiSkip === "esc") {
      if (ch === "[") {
        ansiSkip = "csi";
        continue;
      }
      if (ch === "]") {
        ansiSkip = "osc";
        continue;
      }
      ansiSkip = "none";
      // Drop rare two-char ESC followers
      continue;
    }
    if (ansiSkip === "csi") {
      // CSI ends on final byte @-~
      if (ch >= "@" && ch <= "~") ansiSkip = "none";
      continue;
    }
    if (ansiSkip === "osc") {
      if (ch === "\u0007") {
        ansiSkip = "none";
        continue;
      }
      if (ch === "\x1b") {
        ansiSkip = "esc";
        continue;
      }
      continue;
    }
    if (ch === "\x1b") {
      ansiSkip = "esc";
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const cmd = sanitizeTerminalCommandLabel(inputLineBuf);
      inputLineBuf = "";
      ansiSkip = "none";
      if (!cmd) continue;
      autoTitled = true;
      rightTabs.autoTitleTab(props.instanceId, truncateTabLabel(cmd));
      return;
    }
    if (ch === "\u007f" || ch === "\b") {
      inputLineBuf = inputLineBuf.slice(0, -1);
      continue;
    }
    // Ignore other control bytes; keep printable + tab
    if (ch === "\t" || ch >= " ") inputLineBuf += ch;
  }
}

function bindXterm(host: HTMLDivElement): Terminal {
  term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: "Cascadia Code, Consolas, Menlo, monospace",
    rightClickSelectsWord: false,
    scrollback: 5000,
    windowOptions: {},
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
  term.onData((data) => {
    noteUserInput(data);
    if (activePtyId.value) void window.api.terminal.write(activePtyId.value, data);
  });
  host.addEventListener("contextmenu", onContextMenu, true);
  return term;
}

/** Tear down xterm UI only — keep the pty process running. */
function detachUi(): void {
  hostRef.value?.removeEventListener("contextmenu", onContextMenu, true);
  if (writeRaf) {
    cancelAnimationFrame(writeRaf);
    writeRaf = 0;
  }
  writeBuf = "";
  term?.dispose();
  term = null;
  fit = null;
  ready.value = false;
}

async function start(): Promise<void> {
  const host = hostRef.value;
  if (!host || term) return;

  const preferredCwd = (props.cwd || workspace.root || "").trim();
  if (!preferredCwd && !props.ptyId) return;

  let id = props.ptyId?.trim() || null;
  if (id) {
    const alive = await window.api.terminal.isAlive(id);
    if (!alive) id = null;
  }

  if (!id) {
    if (!preferredCwd) return;
    id = await window.api.terminal.create(preferredCwd);
    if (props.instanceId) {
      rightTabs.patchTab(props.instanceId, { ptyId: id, cwd: preferredCwd });
    }
  }

  activePtyId.value = id;
  term = bindXterm(host);

  const history = await window.api.terminal.getScrollback(id);
  if (history && term) {
    enqueueWrite(history);
  }

  await nextTick();
  scheduleFit();
  term?.focus();
  ready.value = true;
}

watch(
  () => props.visible,
  (v) => {
    if (!v || !term) return;
    term.options.theme = xtermTheme(appearance.resolvedTheme === "dark");
    scheduleFit();
  },
);

watch(
  () => appearance.resolvedTheme,
  () => {
    if (!term || !props.visible) return;
    term.options.theme = xtermTheme(appearance.resolvedTheme === "dark");
  },
);

onMounted(async () => {
  offData = window.api.terminal.onData(({ id, data }) => {
    if (id === activePtyId.value) enqueueWrite(data);
  });
  resizeObserver = new ResizeObserver(() => scheduleFit());
  if (hostRef.value) resizeObserver.observe(hostRef.value);
  if (!workspace.root) await workspace.getWorkspace();
  // Prefer tab host even when global workspace briefly differs during switch
  if (props.ptyId || props.cwd || workspace.root) await start();
});

onBeforeUnmount(() => {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  offData?.();
  offData = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  // Workspace switch remounts tabs — never kill pty here.
  // Explicit tab close disposes via rightTabs.closeTab.
  detachUi();
  activePtyId.value = null;
});
</script>

<template>
  <div class="terminal-tab">
    <div v-if="!props.ptyId && !props.cwd && !workspace.root" class="empty">
      {{ t.terminalEmpty }}
    </div>
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
  background: var(--bg-elevated);
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
  color: var(--fg-strong, #27272a);
}

.term-host :deep(.xterm-viewport) {
  overflow-y: auto !important;
}

.term-host :deep(.xterm-helper-textarea),
.term-host :deep(.xterm-composition-view) {
  color: var(--fg-strong, #27272a) !important;
  caret-color: var(--fg-strong, #27272a) !important;
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
