<script setup lang="ts">
import { computed, defineAsyncComponent, watch } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import type { SplitpanesResizedPayload } from "splitpanes";

/**
 * Heavy workspace chrome — load lazily so the shell paints and stays
 * responsive on slower CPUs while the chat / sidebar / right pane boot.
 */
const SessionSidebar = defineAsyncComponent(
  () => import("@renderer/components/SessionSidebar.vue"),
);
const ChatPanel = defineAsyncComponent(
  () => import("@renderer/components/ChatPanel.vue"),
);
const RightPane = defineAsyncComponent(
  () => import("@renderer/components/RightPane.vue"),
);
const BottomPanel = defineAsyncComponent(
  () => import("@renderer/components/BottomPanel.vue"),
);

/** Nested splits: outer left↔main, inner chat↔right, chat area chat↔bottom panel. */
const PANE_MIN = 15;
const CHAT_MIN = 12;
const PANE_MAX = 70;
/** Chat area (top) vs bottom panel share the centre column. */
const CHAT_TOP_MIN = 25;
const PANEL_MIN = 18;
const PANEL_MAX = 75;

const workspace = useWorkspaceStore();
const layout = useLayoutStore();

watch(
  () => workspace.root,
  (root) => {
    if (root) layout.loadForWorkspace(root);
  },
  { immediate: true },
);

/** Outer: left % of window (rest is main). */
const outerLeftSize = computed(() => layout.leftSize);
const outerMainSize = computed(() => 100 - layout.leftSize);

/** While the editor is maximized the sidebar is forced hidden. */
const effectiveLeftCollapsed = computed(
  () => layout.leftCollapsed || layout.editorMaximized,
);

/** Inner sizes as % of main (chat + right). */
const innerPair = computed(() => {
  const c = layout.centerSize;
  const r = layout.rightSize;
  const sum = c + r;
  if (sum <= 0) return { chat: 37.5, right: 62.5 };
  return { chat: (c / sum) * 100, right: (r / sum) * 100 };
});

/**
 * Maximized: the chat column is fully hidden and the right (editor) pane
 * covers the window. Normal: the persisted chat/right ratio.
 */
const chatPaneSize = computed(() =>
  layout.editorMaximized ? 0 : innerPair.value.chat,
);
const rightPaneSize = computed(() =>
  layout.editorMaximized ? 100 : innerPair.value.right,
);

function onOuterResized(payload: SplitpanesResizedPayload): void {
  if (effectiveLeftCollapsed.value || payload.panes.length < 2) return;
  const leftPct = payload.panes[0].size;
  const mainPct = 100 - leftPct;
  const ratio =
    layout.centerSize + layout.rightSize > 0
      ? layout.centerSize / (layout.centerSize + layout.rightSize)
      : 0.375;
  const center = mainPct * ratio;
  const right = mainPct - center;
  layout.setPaneSizes(leftPct, center, right);
}

function onInnerResized(payload: SplitpanesResizedPayload): void {
  if (layout.rightCollapsed || layout.editorMaximized || payload.panes.length < 2) return;
  const chatOfMain = payload.panes[0].size;
  const rightOfMain = payload.panes[1].size;
  const mainPct = layout.leftCollapsed ? 100 : 100 - layout.leftSize;
  const center = (chatOfMain / 100) * mainPct;
  const right = (rightOfMain / 100) * mainPct;
  layout.setPaneSizes(layout.leftSize, center, right);
}

/** Bottom panel height is relative to the centre column. */
function onChatResized(payload: SplitpanesResizedPayload): void {
  if (layout.bottomCollapsed || payload.panes.length < 2) return;
  const bottomOfColumn = payload.panes[1].size;
  layout.setBottomSize(bottomOfColumn);
}
</script>

<template>
  <div class="split-root">
    <Splitpanes class="panes" @resized="onOuterResized">
      <Pane
        :size="effectiveLeftCollapsed ? 0 : outerLeftSize"
        :min-size="effectiveLeftCollapsed ? 0 : PANE_MIN"
        :max-size="effectiveLeftCollapsed ? 0 : PANE_MAX"
        :class="{ 'pane-collapsed': effectiveLeftCollapsed }"
      >
        <SessionSidebar />
      </Pane>

      <Pane
        :size="effectiveLeftCollapsed ? 100 : outerMainSize"
        :min-size="effectiveLeftCollapsed ? 100 : 100 - PANE_MAX"
      >
        <Splitpanes class="panes inner" @resized="onInnerResized">
          <Pane
            :size="layout.rightCollapsed ? 100 : chatPaneSize"
            :min-size="layout.editorMaximized ? 0 : CHAT_MIN"
            :max-size="layout.rightCollapsed ? 100 : PANE_MAX"
          >
            <Splitpanes
              horizontal
              class="panes chat-split"
              :class="{ 'panel-collapsed': layout.bottomCollapsed }"
              @resized="onChatResized"
            >
              <Pane
                :size="layout.bottomCollapsed ? 100 : 100 - layout.bottomSize"
                :min-size="CHAT_TOP_MIN"
                :max-size="layout.bottomCollapsed ? 100 : 100 - PANEL_MIN"
              >
                <ChatPanel />
              </Pane>
              <Pane
                :size="layout.bottomCollapsed ? 0 : layout.bottomSize"
                :min-size="layout.bottomCollapsed ? 0 : PANEL_MIN"
                :max-size="layout.bottomCollapsed ? 0 : PANEL_MAX"
                :class="{ 'pane-collapsed': layout.bottomCollapsed }"
              >
                <BottomPanel />
              </Pane>
            </Splitpanes>
          </Pane>
          <Pane
            :size="layout.rightCollapsed ? 0 : rightPaneSize"
            :min-size="layout.rightCollapsed ? 0 : PANE_MIN"
            :max-size="layout.rightCollapsed ? 0 : layout.editorMaximized ? 100 : PANE_MAX"
            :class="{ 'pane-collapsed': layout.rightCollapsed }"
          >
            <RightPane />
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>
  </div>
</template>

<style scoped>
.split-root {
  position: relative;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.panes {
  height: 100%;
}

:deep(.splitpanes) {
  height: 100%;
}

:deep(.splitpanes__pane) {
  overflow: hidden;
  background: var(--bg);
  display: flex;
  flex-direction: column;
}

:deep(.splitpanes__pane > *) {
  flex: 1;
  min-height: 0;
  height: 100%;
}

:deep(.pane-collapsed) {
  overflow: hidden !important;
  pointer-events: none;
  visibility: hidden;
}

.chat-split.panel-collapsed :deep(.splitpanes__splitter) {
  display: none;
}
</style>
