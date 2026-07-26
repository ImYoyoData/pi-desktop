<script setup lang="ts">
import { computed, watch } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import { NButton, NIcon, NTooltip } from "naive-ui";
import { ChevronBackOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import SessionSidebar from "@renderer/components/SessionSidebar.vue";
import ChatPanel from "@renderer/components/ChatPanel.vue";
import RightPane from "@renderer/components/RightPane.vue";
import { useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import type { SplitpanesResizedPayload } from "splitpanes";
import { t } from "@renderer/i18n";

/** Nested splits: outer left↔main, inner chat↔right — sides never fight each other. */
const PANE_MIN = 15;
const CHAT_MIN = 12;
const PANE_MAX = 70;

const workspace = useWorkspaceStore();
const layout = useLayoutStore();

watch(
  () => workspace.root,
  (root) => {
    if (root) layout.loadForWorkspace(root);
  },
  { immediate: true },
);

const splitKey = computed(
  () => `${layout.leftCollapsed ? "L0" : "L1"}-${layout.rightCollapsed ? "R0" : "R1"}`,
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
  if (layout.rightCollapsed || payload.panes.length < 2) return;
  const chatOfMain = payload.panes[0].size;
  const rightOfMain = payload.panes[1].size;
  const mainPct = layout.leftCollapsed ? 100 : 100 - layout.leftSize;
  const center = (chatOfMain / 100) * mainPct;
  const right = (rightOfMain / 100) * mainPct;
  layout.setPaneSizes(layout.leftSize, center, right);
}
</script>

<template>
  <div class="split-root">
    <Splitpanes :key="splitKey" class="panes" @resized="onOuterResized">
      <Pane
        v-if="!layout.leftCollapsed"
        :size="outerLeftSize"
        :min-size="PANE_MIN"
        :max-size="PANE_MAX"
      >
        <SessionSidebar />
      </Pane>

      <Pane :size="layout.leftCollapsed ? 100 : outerMainSize" :min-size="100 - PANE_MAX">
        <Splitpanes class="panes inner" @resized="onInnerResized">
          <Pane
            :size="layout.rightCollapsed ? 100 : innerPair.chat"
            :min-size="CHAT_MIN"
            :max-size="layout.rightCollapsed ? 100 : PANE_MAX"
          >
            <ChatPanel />
          </Pane>
          <Pane
            v-if="!layout.rightCollapsed"
            :size="innerPair.right"
            :min-size="PANE_MIN"
            :max-size="PANE_MAX"
          >
            <RightPane />
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>

    <NTooltip v-if="layout.leftCollapsed" placement="right">
      <template #trigger>
        <NButton class="rail left" quaternary size="tiny" @click="layout.toggleLeftCollapsed()">
          <template #icon>
            <NIcon :component="ChevronForwardOutline" :size="16" />
          </template>
        </NButton>
      </template>
      {{ t.expandLeft }}
    </NTooltip>

    <NTooltip v-if="layout.rightCollapsed" placement="left">
      <template #trigger>
        <NButton class="rail right" quaternary size="tiny" @click="layout.toggleRightCollapsed()">
          <template #icon>
            <NIcon :component="ChevronBackOutline" :size="16" />
          </template>
        </NButton>
      </template>
      {{ t.expandRight }}
    </NTooltip>
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

.rail {
  position: absolute !important;
  top: 50%;
  z-index: 5;
  transform: translateY(-50%);
  width: 22px !important;
  min-width: 22px !important;
  height: 56px !important;
  padding: 0 !important;
  border: 1px solid var(--border) !important;
  border-radius: 6px !important;
  background: var(--bg-elevated) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  color: var(--fg-muted) !important;
}

.rail:hover {
  color: var(--fg-strong) !important;
  border-color: var(--border-strong) !important;
}

.rail.left {
  left: 6px;
}

.rail.right {
  right: 6px;
}
</style>
