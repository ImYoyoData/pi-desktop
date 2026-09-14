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

/** Inner sizes as % of main (chat + right). */
const innerPair = computed(() => {
  const c = layout.centerSize;
  const r = layout.rightSize;
  const sum = c + r;
  if (sum <= 0) return { chat: 37.5, right: 62.5 };
  return { chat: (c / sum) * 100, right: (r / sum) * 100 };
});

/** 聊天列（消息区）是否可见：最大化时整列让给编辑器区域。 */
const chatVisible = computed(() => !layout.editorMaximized);

/** 最大化时聊天列默认隐藏；底栏展开时仅用该列承载面板。 */
const chatPaneSize = computed(() =>
  layout.editorMaximized
    ? layout.bottomCollapsed
      ? 0
      : innerPair.value.chat
    : layout.rightCollapsed
      ? 100
      : innerPair.value.chat,
);
const rightPaneSize = computed(() => 100 - chatPaneSize.value);
const chatTopSize = computed(() =>
  layout.editorMaximized
    ? layout.bottomCollapsed
      ? 100
      : 0
    : layout.bottomCollapsed
      ? 100
      : 100 - layout.bottomSize,
);
const bottomPanelSize = computed(() =>
  layout.editorMaximized
    ? layout.bottomCollapsed
      ? 0
      : 100
    : layout.bottomCollapsed
      ? 0
      : layout.bottomSize,
);

function onOuterResized(payload: SplitpanesResizedPayload): void {
  if (layout.leftCollapsed || payload.panes.length < 2) return;
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
        :size="layout.leftCollapsed ? 0 : outerLeftSize"
        :min-size="layout.leftCollapsed ? 0 : PANE_MIN"
        :max-size="layout.leftCollapsed ? 0 : PANE_MAX"
        :class="{ 'pane-collapsed': layout.leftCollapsed }"
      >
        <SessionSidebar />
      </Pane>

      <Pane
        :size="layout.leftCollapsed ? 100 : outerMainSize"
        :min-size="layout.leftCollapsed ? 100 : 100 - PANE_MAX"
      >
        <Splitpanes class="panes inner" @resized="onInnerResized">
          <Pane
            :size="chatPaneSize"
            :min-size="layout.editorMaximized ? 0 : CHAT_MIN"
            :max-size="layout.editorMaximized || layout.rightCollapsed ? 100 : PANE_MAX"
            :class="{ 'pane-collapsed': layout.editorMaximized && layout.bottomCollapsed }"
          >
            <Splitpanes
              horizontal
              class="panes chat-split"
              :class="{ 'panel-collapsed': layout.editorMaximized || layout.bottomCollapsed }"
              @resized="onChatResized"
            >
              <Pane
                :size="chatTopSize"
                :min-size="layout.editorMaximized ? 0 : CHAT_TOP_MIN"
                :max-size="layout.editorMaximized || layout.bottomCollapsed ? 100 : 100 - PANEL_MIN"
                :class="{ 'pane-collapsed': layout.editorMaximized }"
              >
                <ChatPanel :visible="chatVisible" />
              </Pane>
              <Pane
                :size="bottomPanelSize"
                :min-size="layout.editorMaximized || layout.bottomCollapsed ? 0 : PANEL_MIN"
                :max-size="layout.editorMaximized ? 100 : layout.bottomCollapsed ? 0 : PANEL_MAX"
                :class="{ 'pane-collapsed': layout.bottomCollapsed }"
              >
                <BottomPanel />
              </Pane>
            </Splitpanes>
          </Pane>
          <Pane
            :size="layout.rightCollapsed && !layout.editorMaximized ? 0 : rightPaneSize"
            :min-size="layout.rightCollapsed || layout.editorMaximized ? 0 : PANE_MIN"
            :max-size="layout.rightCollapsed && !layout.editorMaximized ? 0 : layout.editorMaximized ? 100 : PANE_MAX"
            :class="{ 'pane-collapsed': layout.rightCollapsed && !layout.editorMaximized }"
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

.split-root :deep(.splitpanes__pane) {
  overflow: hidden;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  /* splitpanes 默认给面板宽高加 0.2s 过渡，折叠/最大化会逐帧重排重内容区；
     展开收起瞬时生效，一次布局代替十几帧。 */
  transition: none;
  will-change: auto;
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
  /* 隐藏面板整棵子树跳过布局/绘制（保留 DOM 与组件状态）。 */
  content-visibility: hidden;
}

.chat-split.panel-collapsed :deep(.splitpanes__splitter) {
  display: none;
}
</style>
