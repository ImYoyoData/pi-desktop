<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Splitpanes, Pane } from "splitpanes";
import "splitpanes/dist/splitpanes.css";
import SessionSidebar from "@renderer/components/SessionSidebar.vue";
import ChatPanel from "@renderer/components/ChatPanel.vue";
import RightPane from "@renderer/components/RightPane.vue";
import { clampPanelWidth, useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import type { SplitpanesResizedPayload } from "splitpanes";

const workspace = useWorkspaceStore();
const layout = useLayoutStore();
const rootEl = ref<HTMLElement | null>(null);

watch(
  () => workspace.root,
  (root) => {
    if (root) {
      layout.loadForWorkspace(root);
    }
  },
  { immediate: true },
);

function containerWidth(): number {
  return rootEl.value?.clientWidth ?? 0;
}

function pxToSize(px: number): number {
  const total = containerWidth();
  if (total <= 0 || px <= 0) {
    return 0;
  }
  return (px / total) * 100;
}

function minSizePercent(): number {
  return pxToSize(180) || 0;
}

const leftPaneSize = computed(() => (layout.leftCollapsed ? 0 : pxToSize(layout.leftWidth)));
const rightPaneSize = computed(() => (layout.rightCollapsed ? 0 : pxToSize(layout.rightWidth)));

function onResized(payload: SplitpanesResizedPayload): void {
  const total = containerWidth();
  if (total <= 0 || payload.panes.length < 3) {
    return;
  }
  const [left, , right] = payload.panes;
  if (!layout.leftCollapsed && left.size > 0) {
    layout.setLeftWidth(clampPanelWidth((left.size / 100) * total));
  }
  if (!layout.rightCollapsed && right.size > 0) {
    layout.setRightWidth(clampPanelWidth((right.size / 100) * total));
  }
}
</script>

<template>
  <div ref="rootEl" class="split-root">
    <Splitpanes class="panes" @resized="onResized">
      <Pane
        :size="leftPaneSize"
        :min-size="layout.leftCollapsed ? 0 : minSizePercent()"
        :max-size="pxToSize(560)"
      >
        <SessionSidebar />
      </Pane>
      <Pane :min-size="20">
        <ChatPanel />
      </Pane>
      <Pane
        :size="rightPaneSize"
        :min-size="layout.rightCollapsed ? 0 : minSizePercent()"
        :max-size="pxToSize(560)"
      >
        <RightPane />
      </Pane>
    </Splitpanes>
    <button
      v-if="layout.leftCollapsed"
      type="button"
      class="expand left"
      title="Expand sessions"
      @click="layout.toggleLeftCollapsed()"
    >
      &rsaquo;
    </button>
    <button
      v-if="layout.rightCollapsed"
      type="button"
      class="expand right"
      title="Expand right panel"
      @click="layout.toggleRightCollapsed()"
    >
      &lsaquo;
    </button>
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

:deep(.splitpanes__pane) {
  overflow: hidden;
}

.expand {
  position: absolute;
  top: 50%;
  z-index: 2;
  transform: translateY(-50%);
  padding: 0.35rem 0.4rem;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
}

.expand.left {
  left: 4px;
}

.expand.right {
  right: 4px;
}
</style>
