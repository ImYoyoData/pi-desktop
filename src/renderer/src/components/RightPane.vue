<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, watch } from "vue";
import type { DropdownOption } from "naive-ui";
import {
  NButton,
  NDropdown,
  NEmpty,
  NIcon,
  NSpace,
  NTabPane,
  NTabs,
  NTooltip,
  useDialog,
} from "naive-ui";
import {
  AddOutline,
  DocumentTextOutline,
  GitCompareOutline,
  GlobeOutline,
  TerminalOutline,
  ChevronForwardOutline,
} from "@vicons/ionicons5";
import Sortable from "sortablejs";
import ChangesTab from "@renderer/components/ChangesTab.vue";
import BrowserTab from "@renderer/components/BrowserTab.vue";
import TerminalTab from "@renderer/components/TerminalTab.vue";
import PreviewTab from "@renderer/components/PreviewTab.vue";
import { useLayoutStore } from "@renderer/stores/layout";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore, type RightTab, type RightTabKind } from "@renderer/stores/right-tabs";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { t } from "@renderer/i18n";

const layout = useLayoutStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const dialog = useDialog();

let tabsSortable: Sortable | null = null;
const tabsRowRef = { el: null as HTMLElement | null };

function setTabsRowRef(el: unknown): void {
  tabsRowRef.el = el instanceof HTMLElement ? el : null;
}

function destroyTabsSortable(): void {
  tabsSortable?.destroy();
  tabsSortable = null;
}

function bindTabsSortable(): void {
  destroyTabsSortable();
  const root = tabsRowRef.el;
  if (!root || rightTabs.tabs.length < 2) return;
  const container =
    root.querySelector<HTMLElement>(".n-tabs-nav-scroll-content")
    ?? root.querySelector<HTMLElement>(".n-tabs-wrapper")
    ?? root.querySelector<HTMLElement>(".n-tabs-nav");
  if (!container) return;
  tabsSortable = Sortable.create(container, {
    animation: 150,
    draggable: ".n-tabs-tab-wrapper, .n-tabs-tab",
    onEnd: (evt) => {
      const oldIndex = evt.oldIndex;
      const newIndex = evt.newIndex;
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return;
      rightTabs.reorderTabs(oldIndex, newIndex);
    },
  });
}

watch(
  () => previewStore.openSignal,
  () => {
    if (previewStore.filePath) {
      rightTabs.addTab("preview", {
        filePath: previewStore.filePath,
        label: previewStore.filePath.split(/[/\\]/).pop() ?? t.preview,
      });
      void rightTabs.refreshPreviewGitMeta();
      if (layout.rightCollapsed) layout.toggleRightCollapsed();
    }
  },
);

onMounted(() => {
  // Drop legacy "files" tabs — explorer lives under left sidebar now
  for (const tab of [...rightTabs.tabs]) {
    if (tab.kind === "files") rightTabs.closeTab(tab.id);
  }
  void rightTabs.refreshPreviewGitMeta();
  void nextTick(() => bindTabsSortable());
});

onUnmounted(() => {
  destroyTabsSortable();
});

watch(
  () => rightTabs.tabs.map((t) => t.id).join("|"),
  () => {
    void nextTick(() => bindTabsSortable());
  },
);

function iconFor(kind: RightTabKind) {
  switch (kind) {
    case "changes":
      return GitCompareOutline;
    case "files":
      return DocumentTextOutline;
    case "browser":
      return GlobeOutline;
    case "terminal":
      return TerminalOutline;
    case "preview":
      return DocumentTextOutline;
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

function tabDisplayLabel(tab: RightTab): string {
  const base = tab.label;
  if (tab.missing) return base;
  if (tab.dirty) return `${base}*`;
  return base;
}

function tabLabelStyle(tab: RightTab): Record<string, string> | undefined {
  if (tab.missing) {
    return {
      color: gitCodeColor("D"),
      textDecoration: "line-through",
    };
  }
  if (tab.gitCode) return { color: gitCodeColor(tab.gitCode) };
  if (tab.dirty) return { color: gitCodeColor("M") };
  return undefined;
}

const addOptions: DropdownOption[] = [
  {
    label: t.terminal,
    key: "terminal",
    icon: () => h(NIcon, null, { default: () => h(TerminalOutline) }),
  },
  {
    label: t.browser,
    key: "browser",
    icon: () => h(NIcon, null, { default: () => h(GlobeOutline) }),
  },
  {
    label: t.changesTab,
    key: "changes",
    icon: () => h(NIcon, null, { default: () => h(GitCompareOutline) }),
  },
];

async function onAddSelect(key: string | number): Promise<void> {
  rightTabs.addTab(String(key) as RightTabKind);
}

const active = computed(() => rightTabs.activeTab);

function doClose(id: string): void {
  rightTabs.closeTab(id);
}

function onTabClose(name: string | number): void {
  const id = String(name);
  const tab = rightTabs.tabs.find((t) => t.id === id);
  if (!tab) return;

  // Deleted on disk — ask whether to recreate via save
  if (tab.kind === "preview" && tab.missing) {
    const d = dialog.create({
      type: "warning",
      title: t.fileDeletedTitle,
      content: t.fileDeletedSavePrompt,
      closable: true,
      maskClosable: false,
      closeOnEsc: true,
      action: () =>
        h(
          NSpace,
          { justify: "end", size: 8 },
          {
            default: () => [
              h(
                NButton,
                {
                  size: "small",
                  onClick: () => {
                    d.destroy();
                  },
                },
                { default: () => t.cancel },
              ),
              h(
                NButton,
                {
                  size: "small",
                  onClick: () => {
                    d.destroy();
                    doClose(id);
                  },
                },
                { default: () => t.dontSave },
              ),
              h(
                NButton,
                {
                  size: "small",
                  type: "primary",
                  onClick: () => {
                    void (async () => {
                      const ok = await rightTabs.saveTab(id);
                      if (ok) {
                        d.destroy();
                        doClose(id);
                      }
                    })();
                  },
                },
                { default: () => t.save },
              ),
            ],
          },
        ),
    });
    return;
  }

  if (tab.kind === "preview" && tab.dirty && !tab.missing) {
    dialog.warning({
      title: t.unsavedChangesTitle,
      content: t.unsavedChangesClose(tab.label),
      positiveText: t.save,
      negativeText: t.dontSave,
      closable: true,
      maskClosable: true,
      onPositiveClick: async () => {
        const ok = await rightTabs.saveTab(id);
        if (ok) doClose(id);
        return ok;
      },
      onNegativeClick: () => {
        doClose(id);
      },
    });
    return;
  }
  doClose(id);
}

function onTabChange(name: string | number): void {
  rightTabs.selectTab(String(name));
}
</script>

<template>
  <aside class="right-pane">
    <header class="head">
      <div class="tabs-row" :ref="setTabsRowRef">
        <NTabs
          v-if="rightTabs.tabs.length"
          type="card"
          size="small"
          :value="rightTabs.activeId"
          :tabs-padding="4"
          closable
          @close="onTabClose"
          @update:value="onTabChange"
        >
          <NTabPane
            v-for="tab in rightTabs.tabs"
            :key="tab.id"
            :name="tab.id"
            display-directive="show"
          >
            <template #tab>
              <NSpace :size="4" align="center" :wrap="false">
                <NIcon :component="iconFor(tab.kind)" :size="12" :style="tabLabelStyle(tab)" />
                <span
                  class="tab-label"
                  :class="{ transient: tab.kind === 'preview' && tab.transient !== false && !tab.dirty }"
                  :style="tabLabelStyle(tab)"
                >{{ tabDisplayLabel(tab) }}</span>
              </NSpace>
            </template>
            <div class="pane-placeholder" />
          </NTabPane>
        </NTabs>

        <NDropdown trigger="click" :options="addOptions" @select="onAddSelect">
          <NButton quaternary circle size="tiny" :title="t.newTab">
            <template #icon>
              <NIcon :component="AddOutline" :size="14" />
            </template>
          </NButton>
        </NDropdown>
      </div>

      <NTooltip>
        <template #trigger>
          <NButton
            class="collapse-btn"
            quaternary
            circle
            size="tiny"
            @click="layout.toggleRightCollapsed()"
          >
            <template #icon>
              <NIcon :component="ChevronForwardOutline" :size="16" />
            </template>
          </NButton>
        </template>
        {{ t.collapseRight }}
      </NTooltip>
    </header>

    <div class="body">
      <template v-for="tab in rightTabs.tabs" :key="tab.id">
        <ChangesTab
          v-show="active?.id === tab.id && tab.kind === 'changes'"
          class="tab-panel"
        />
        <BrowserTab
          v-if="tab.kind === 'browser'"
          v-show="active?.id === tab.id"
          class="tab-panel"
          :tab-id="tab.id"
          :visible="active?.id === tab.id && !layout.rightCollapsed"
        />
        <TerminalTab
          v-if="tab.kind === 'terminal'"
          v-show="active?.id === tab.id"
          class="tab-panel"
          :instance-id="tab.id"
          :visible="active?.id === tab.id && !layout.rightCollapsed"
        />
        <PreviewTab
          v-if="tab.kind === 'preview'"
          v-show="active?.id === tab.id"
          class="tab-panel"
          :tab-id="tab.id"
          :file-path="tab.filePath ?? null"
          :active="active?.id === tab.id"
        />
      </template>
      <NEmpty
        v-if="!rightTabs.tabs.length"
        :description="t.clickToAddTab"
        class="empty"
        size="small"
      />
    </div>
  </aside>
</template>

<style scoped>
.right-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--bg);
  border-left: 1px solid var(--border);
}

.head {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 32px;
  height: 32px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--bg-elevated));
  flex-shrink: 0;
}

.collapse-btn {
  flex-shrink: 0;
}

.tabs-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  height: 100%;
}

.tabs-row :deep(.n-tabs) {
  flex: 1;
  min-width: 0;
  height: 100%;
}

.tabs-row :deep(.n-tabs-nav) {
  padding-top: 0 !important;
  line-height: 1;
}

.tabs-row :deep(.n-tabs-tab) {
  padding: 2px 8px !important;
  font-size: 11.5px !important;
  height: 24px !important;
  border-radius: 7px !important;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.tabs-row :deep(.n-tabs-tab__close) {
  margin-left: 2px;
  font-size: 12px;
}

.tabs-row :deep(.n-tabs-pane-wrapper) {
  display: none;
}

.tab-label {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
}

.tab-label.transient {
  font-style: italic;
  font-weight: 450;
}

.pane-placeholder {
  display: none;
}

.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.tab-panel {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty {
  flex: 1;
  display: grid;
  place-items: center;
}
</style>
