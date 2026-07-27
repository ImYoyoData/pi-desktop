<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { DropdownOption } from "naive-ui";
import {
  NButton,
  NDropdown,
  NEmpty,
  NIcon,
  NSpace,
  NTooltip,
  useDialog,
} from "naive-ui";
import {
  AddOutline,
  CloseOutline,
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
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { t } from "@renderer/i18n";

const layout = useLayoutStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const workspace = useWorkspaceStore();
const dialog = useDialog();

const tabsBarRef = ref<HTMLElement | null>(null);
let tabsSortable: Sortable | null = null;

function destroyTabsSortable(): void {
  tabsSortable?.destroy();
  tabsSortable = null;
}

function bindTabsSortable(): void {
  destroyTabsSortable();
  const el = tabsBarRef.value;
  if (!el || rightTabs.tabs.length < 2) return;
  tabsSortable = Sortable.create(el, {
    animation: 150,
    direction: "horizontal",
    draggable: ".tab-item",
    filter: ".tab-close",
    preventOnFilter: false,
    delay: 0,
    delayOnTouchOnly: true,
    onEnd: () => {
      const ids = [...el.querySelectorAll<HTMLElement>(".tab-item[data-id]")]
        .map((n) => n.dataset.id)
        .filter((id): id is string => Boolean(id));
      if (ids.length !== rightTabs.tabs.length) return;
      const same = ids.every((id, i) => rightTabs.tabs[i]?.id === id);
      if (same) return;
      rightTabs.reorderByIds(ids);
      rightTabs.persistTabs(workspace.root);
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
  () => rightTabs.tabs.map((tab) => tab.id).join("|"),
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
  const kind = String(key) as RightTabKind;
  if (kind === "terminal") {
    rightTabs.addTab("terminal", { cwd: workspace.root ?? undefined });
    return;
  }
  rightTabs.addTab(kind);
}

const active = computed(() => rightTabs.activeTab);

function doClose(id: string): void {
  rightTabs.closeTab(id);
}

function onTabClose(name: string | number): void {
  const id = String(name);
  const tab = rightTabs.tabs.find((item) => item.id === id);
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

function onTabChange(id: string): void {
  rightTabs.selectTab(id);
}
</script>

<template>
  <aside class="right-pane">
    <header class="head">
      <div class="tabs-row">
        <div ref="tabsBarRef" class="tabs-bar">
          <div
            v-for="tab in rightTabs.tabs"
            :key="tab.id"
            class="tab-item"
            :class="{ active: tab.id === rightTabs.activeId }"
            :data-id="tab.id"
            role="tab"
            :aria-selected="tab.id === rightTabs.activeId"
            @click="onTabChange(tab.id)"
          >
            <NIcon :component="iconFor(tab.kind)" :size="12" :style="tabLabelStyle(tab)" />
            <span
              class="tab-label"
              :class="{ transient: tab.kind === 'preview' && tab.transient !== false && !tab.dirty }"
              :style="tabLabelStyle(tab)"
            >{{ tabDisplayLabel(tab) }}</span>
            <button
              type="button"
              class="tab-close"
              :title="t.closeTab"
              @click.stop="onTabClose(tab.id)"
            >
              <NIcon :component="CloseOutline" :size="12" />
            </button>
          </div>
        </div>

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
          :pty-id="tab.ptyId ?? null"
          :cwd="tab.cwd ?? null"
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

.tabs-bar {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  scrollbar-width: none;
}

.tabs-bar::-webkit-scrollbar {
  display: none;
}

.tab-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 140px;
  height: 24px;
  padding: 0 6px 0 8px;
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

.tab-item:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.tab-item.active {
  background: var(--bg-elevated);
  border-color: var(--border);
  color: var(--fg-strong);
  box-shadow: var(--shadow-sm);
}

.tab-item.sortable-ghost {
  opacity: 0.35;
}

.tab-item.sortable-drag {
  opacity: 0.95;
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}

.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 0;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-faint);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.55;
}

.tab-item:hover .tab-close,
.tab-item.active .tab-close {
  opacity: 1;
}

.tab-close:hover {
  background: var(--bg-active);
  color: var(--fg);
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

.body {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.tab-panel {
  position: absolute;
  inset: 0;
  min-height: 0;
  overflow: hidden;
}

.empty {
  margin-top: 40px;
}
</style>
