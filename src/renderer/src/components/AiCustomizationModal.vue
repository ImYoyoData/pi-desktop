<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref, watch } from "vue";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import AiCustomizationPage from "@renderer/components/AiCustomizationPage.vue";
import { useLayoutStore } from "@renderer/stores/layout";
import { t } from "@renderer/i18n";

/**
 * VS Code modal editor 形态：居中浮层 + 40px 独立标题栏 + 半透明遮罩。
 * 尺寸取自 modalEditorPart.ts：默认 80%（上限 1400×900），最小 400×300。
 */
const TITLE_BAR_HEIGHT = 36;
const MAX_WIDTH = 1400;
const MAX_HEIGHT = 900;
const EDGE_PADDING = 8;

const layout = useLayoutStore();
const maximized = ref(false);
const dragging = ref(false);
const frame = reactive({ width: 0, height: 0, left: 0, top: 0 });

function computeFrame(): void {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const availableHeight = viewportHeight - TITLE_BAR_HEIGHT;
  if (maximized.value) {
    frame.width = viewportWidth - EDGE_PADDING * 2;
    frame.height = availableHeight - EDGE_PADDING * 2;
    frame.left = EDGE_PADDING;
    frame.top = TITLE_BAR_HEIGHT + EDGE_PADDING;
    return;
  }
  const width = Math.min(viewportWidth * 0.8, MAX_WIDTH);
  const height = Math.min(availableHeight * 0.8, MAX_HEIGHT);
  frame.width = width;
  frame.height = height;
  frame.left = (viewportWidth - width) / 2;
  frame.top = TITLE_BAR_HEIGHT + (availableHeight - height) / 2;
}

function toggleMaximized(): void {
  maximized.value = !maximized.value;
  computeFrame();
}

function close(): void {
  layout.showChat();
}

function onHeaderPointerDown(event: PointerEvent): void {
  if ((event.target as HTMLElement).closest("button") || maximized.value) return;
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = frame.left;
  const startTop = frame.top;
  dragging.value = true;
  const onMove = (move: PointerEvent) => {
    frame.left = Math.min(
      Math.max(startLeft + move.clientX - startX, EDGE_PADDING),
      window.innerWidth - frame.width - EDGE_PADDING,
    );
    frame.top = Math.min(
      Math.max(startTop + move.clientY - startY, TITLE_BAR_HEIGHT + EDGE_PADDING),
      window.innerHeight - frame.height - EDGE_PADDING,
    );
  };
  const onUp = () => {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Esc 关闭；页面内打开的 naive-ui 模态优先消费 Esc。 */
function onWindowKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (document.querySelector(".n-modal-container")) return;
  close();
}

/** 每次打开都回到默认位置：重置最大化状态并重新居中。 */
watch(
  () => layout.centerView,
  (view) => {
    if (view !== "customize") return;
    maximized.value = false;
    computeFrame();
  },
);

onMounted(() => {
  computeFrame();
  window.addEventListener("resize", computeFrame);
  window.addEventListener("keydown", onWindowKeydown);
});

onUnmounted(() => {
  window.removeEventListener("resize", computeFrame);
  window.removeEventListener("keydown", onWindowKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="layout.centerView === 'customize'" class="modal-editor-block">
      <div
        class="modal-editor-panel"
        :style="{
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          left: `${frame.left}px`,
          top: `${frame.top}px`,
        }"
      >
        <header
          class="modal-editor-header"
          :class="{ dragging }"
          @pointerdown="onHeaderPointerDown"
          @dblclick="toggleMaximized"
        >
          <div class="modal-editor-title">{{ t.customizeTitle }}</div>
          <div class="modal-editor-actions">
            <button
              type="button"
              class="modal-editor-icon-button"
              :title="maximized ? t.customizeRestore : t.customizeMaximize"
              :aria-label="maximized ? t.customizeRestore : t.customizeMaximize"
              @click="toggleMaximized"
            >
              <CodiconIcon :name="maximized ? 'restore' : 'maximize'" :size="14" />
            </button>
            <span class="modal-editor-action-separator" aria-hidden="true" />
            <button
              type="button"
              class="modal-editor-icon-button"
              :title="t.close"
              :aria-label="t.close"
              @click="close"
            >
              <CodiconIcon name="close" :size="14" />
            </button>
          </div>
        </header>
        <div class="modal-editor-content">
          <AiCustomizationPage :section="layout.customizeSection" :visible="true" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-editor-block {
  position: fixed;
  inset: 0;
  z-index: 1000;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.5);
}

.modal-editor-panel {
  position: absolute;
  display: grid;
  grid-template-rows: auto 1fr;
  min-width: 400px;
  min-height: 300px;
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: var(--shadow-lg);
}

.modal-editor-header {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  height: 40px;
  min-height: 40px;
  padding: 0 8px 0 10px;
  background: var(--bg);
  color: var(--fg);
  user-select: none;
}

.modal-editor-header.dragging {
  cursor: grabbing;
}

.modal-editor-title {
  grid-column: 1;
  overflow: hidden;
  color: var(--fg);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-editor-actions {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}

.modal-editor-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.modal-editor-icon-button:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.modal-editor-icon-button:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.modal-editor-action-separator {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--fg);
  opacity: 0.3;
}

.modal-editor-content {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.modal-editor-content > :deep(.ai-customization-management-editor) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
