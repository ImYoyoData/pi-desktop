<script setup lang="ts">
import { computed, watch } from "vue";
import { NButton, NEmpty, NIcon } from "naive-ui";
import { AddOutline, ChevronDownOutline, CloseOutline, TerminalOutline } from "@vicons/ionicons5";
import TerminalTab from "@renderer/components/TerminalTab.vue";
import { useLayoutStore } from "@renderer/stores/layout";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import { t } from "@renderer/i18n";

const layout = useLayoutStore();
const rightTabs = useRightTabsStore();
const workspace = useWorkspaceStore();

const active = computed(() => rightTabs.activePanelTab);

function newTerminal(): void {
  if (layout.bottomCollapsed) layout.toggleBottomCollapsed();
  rightTabs.addTab("terminal", { cwd: workspace.root ?? undefined });
}

// 展开底栏时确保至少有一个终端
watch(
  () => layout.bottomCollapsed,
  (collapsed) => {
    if (!collapsed && !rightTabs.panelTabs.length) newTerminal();
  },
);

// 工作区恢复的终端原本挂在右栏，底栏收起时需自动展开，避免终端“消失”
watch(
  () => rightTabs.panelTabs.length,
  (count) => {
    if (count > 0 && layout.bottomCollapsed) layout.toggleBottomCollapsed();
  },
  { immediate: true },
);
</script>

<template>
  <section class="bottom-panel">
    <header class="panel-head">
      <div class="panel-tabs">
        <div
          v-for="tab in rightTabs.panelTabs"
          :key="tab.id"
          class="panel-tab"
          :class="{ active: tab.id === rightTabs.panelActiveId }"
          role="tab"
          :aria-selected="tab.id === rightTabs.panelActiveId"
          :data-id="tab.id"
          @click="rightTabs.selectPanelTab(tab.id)"
        >
          <NIcon :component="TerminalOutline" :size="12" />
          <span class="panel-tab-label">{{ localizedTabLabel(tab) }}</span>
          <button
            type="button"
            class="panel-tab-close"
            :title="t.closeTab"
            @click.stop="rightTabs.closeTab(tab.id)"
          >
            <NIcon :component="CloseOutline" :size="12" />
          </button>
        </div>
      </div>

      <NButton
        quaternary
        circle
        size="tiny"
        class="pi-interactive"
        :title="t.newTerminal"
        @click="newTerminal"
      >
        <template #icon>
          <NIcon :component="AddOutline" :size="14" />
        </template>
      </NButton>
      <NButton
        quaternary
        circle
        size="tiny"
        class="pi-interactive"
        :title="t.collapseBottom"
        @click="layout.toggleBottomCollapsed()"
      >
        <template #icon>
          <NIcon :component="ChevronDownOutline" :size="14" />
        </template>
      </NButton>
    </header>

    <div class="panel-body">
      <TerminalTab
        v-for="tab in rightTabs.panelTabs"
        v-show="tab.id === active?.id"
        :key="tab.id"
        class="panel-term"
        :instance-id="tab.id"
        :pty-id="tab.ptyId ?? null"
        :cwd="tab.cwd ?? null"
        :visible="tab.id === active?.id && !layout.bottomCollapsed"
      />
      <NEmpty
        v-if="!rightTabs.panelTabs.length"
        class="panel-empty"
        size="small"
        :description="t.terminalEmptyHint"
      >
        <template #extra>
          <NButton size="tiny" class="pi-interactive" @click="newTerminal">
            <template #icon>
              <NIcon :component="AddOutline" :size="14" />
            </template>
            {{ t.newTerminal }}
          </NButton>
        </template>
      </NEmpty>
    </div>
  </section>
</template>

<style scoped>
.bottom-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
  background: var(--bg);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 32px;
  min-height: 32px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--bg-elevated));
  flex-shrink: 0;
}

.panel-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.panel-tabs::-webkit-scrollbar {
  display: none;
}

.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  height: 24px;
  padding: 0 4px 0 8px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11.5px;
  cursor: pointer;
  flex-shrink: 0;
  user-select: none;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease),
    color var(--duration-fast, 140ms) var(--ease-out, ease);
}

.panel-tab:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.panel-tab.active {
  background: var(--bg-elevated);
  border-color: var(--border);
  color: var(--fg-strong);
  box-shadow: var(--shadow-sm);
}

.panel-tab-label {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}

.panel-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-faint);
  opacity: 0.55;
  cursor: pointer;
  flex-shrink: 0;
}

.panel-tab:hover .panel-tab-close,
.panel-tab.active .panel-tab-close {
  opacity: 1;
}

.panel-tab-close:hover {
  background: var(--bg-active);
  color: var(--fg);
}

.panel-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.panel-term {
  position: absolute;
  inset: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-empty {
  height: 100%;
  justify-content: center;
}
</style>
