<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import type {
  EditContextMenuAction,
  EditContextMenuPayload,
} from "../../../shared/context-menu";

/** 自绘右键编辑菜单：跟随自定义外观（半透明/模糊），命令仍由主进程执行。 */
interface MenuEntry {
  action: EditContextMenuAction;
  label: string;
  accel: string;
  enabled: boolean;
}

const menu = ref<EditContextMenuPayload | null>(null);
const menuEl = ref<HTMLElement | null>(null);
const pos = ref({ x: 0, y: 0 });

const isMac = navigator.userAgent.includes("Mac");

const entries = computed<(MenuEntry | "separator")[]>(() => {
  const payload = menu.value;
  if (!payload) return [];
  const key = (win: string, mac: string): string => (isMac ? mac : win);
  const { labels } = payload;
  if (!payload.isEditable) {
    return [
      {
        action: "copy",
        label: labels.copy,
        accel: key("Ctrl+C", "⌘C"),
        enabled: payload.canCopy,
      },
    ];
  }
  return [
    { action: "undo", label: labels.undo, accel: key("Ctrl+Z", "⌘Z"), enabled: payload.canUndo },
    { action: "redo", label: labels.redo, accel: key("Ctrl+Y", "⇧⌘Z"), enabled: payload.canRedo },
    "separator",
    { action: "cut", label: labels.cut, accel: key("Ctrl+X", "⌘X"), enabled: payload.canCut },
    { action: "copy", label: labels.copy, accel: key("Ctrl+C", "⌘C"), enabled: payload.canCopy },
    { action: "paste", label: labels.paste, accel: key("Ctrl+V", "⌘V"), enabled: payload.canPaste },
    { action: "delete", label: labels.delete, accel: key("Delete", "⌫"), enabled: payload.canDelete },
    "separator",
    {
      action: "selectAll",
      label: labels.selectAll,
      accel: key("Ctrl+A", "⌘A"),
      enabled: payload.canSelectAll,
    },
  ];
});

async function open(payload: EditContextMenuPayload): Promise<void> {
  menu.value = payload;
  pos.value = { x: payload.x, y: payload.y };
  await nextTick();
  const el = menuEl.value;
  if (!el) return;
  const { width, height } = el.getBoundingClientRect();
  const margin = 8;
  pos.value = {
    x: Math.max(margin, Math.min(payload.x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(payload.y, window.innerHeight - height - margin)),
  };
}

function close(): void {
  menu.value = null;
}

function onPointerDown(event: PointerEvent): void {
  if (!menu.value) return;
  if (menuEl.value?.contains(event.target as Node)) return;
  close();
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

function pick(entry: MenuEntry): void {
  if (!entry.enabled) return;
  void window.api.window.runContextMenuAction(entry.action);
  close();
}

let offContextMenu: (() => void) | null = null;

onMounted(() => {
  offContextMenu = window.api.window.onContextMenu((payload) => void open(payload));
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("wheel", close, { capture: true, passive: true });
  window.addEventListener("blur", close);
});

onUnmounted(() => {
  offContextMenu?.();
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("wheel", close, { capture: true });
  window.removeEventListener("blur", close);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="menu"
      ref="menuEl"
      class="app-context-menu"
      :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
      @contextmenu.prevent
      @mousedown.prevent
    >
      <template v-for="(entry, index) in entries" :key="index">
        <div v-if="entry === 'separator'" class="menu-separator" />
        <button
          v-else
          type="button"
          class="menu-item"
          :disabled="!entry.enabled"
          @click="pick(entry)"
        >
          <span class="menu-label">{{ entry.label }}</span>
          <span v-if="entry.accel" class="menu-accel">{{ entry.accel }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.app-context-menu {
  position: fixed;
  z-index: 5000;
  min-width: 168px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated, #ffffff);
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.32));
  font-size: 12.5px;
  user-select: none;
}

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: 100%;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover:not(:disabled) {
  background: var(--bg-hover);
}

.menu-item:disabled {
  color: var(--fg-faint);
  cursor: default;
}

.menu-accel {
  color: var(--fg-muted);
  font-size: 11.5px;
}

.menu-separator {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}
</style>
