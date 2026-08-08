<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { DropdownOption } from "naive-ui";
import {
  NButton,
  NDropdown,
  NEmpty,
  NIcon,
  NInput,
  NModal,
  NSpace,
  NTooltip,
  useDialog,
} from "naive-ui";
import {
  AddOutline,
  CloseOutline,
  CreateOutline,
  DocumentTextOutline,
  GitCompareOutline,
  GlobeOutline,
  PlayCircleOutline,
  TerminalOutline,
  TrashOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
} from "@vicons/ionicons5";
import PanelRightIcon from "@renderer/components/icons/PanelRightIcon.vue";
import Sortable from "sortablejs";
import ChangesTab from "@renderer/components/ChangesTab.vue";
import BrowserTab from "@renderer/components/BrowserTab.vue";
import RunningTab from "@renderer/components/RunningTab.vue";
import TerminalTab from "@renderer/components/TerminalTab.vue";
import PreviewTab from "@renderer/components/PreviewTab.vue";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useLayoutStore } from "@renderer/stores/layout";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore, type RightTab, type RightTabKind } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import { t } from "@renderer/i18n";

const layout = useLayoutStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const workspace = useWorkspaceStore();
const agentRuns = useAgentRunsStore();
const browserNav = useBrowserNavStore();
const dialog = useDialog();

const tabsBarRef = ref<HTMLElement | null>(null);
const canScrollTabsLeft = ref(false);
const canScrollTabsRight = ref(false);
let tabsSortable: Sortable | null = null;
let tabsResizeObs: ResizeObserver | null = null;
let offOpenBrowserTab: (() => void) | null = null;
let offCloseBrowserTab: (() => void) | null = null;

function updateTabsScrollState(): void {
  const el = tabsBarRef.value;
  if (!el) {
    canScrollTabsLeft.value = false;
    canScrollTabsRight.value = false;
    return;
  }
  const max = el.scrollWidth - el.clientWidth;
  const overflow = max > 2;
  canScrollTabsLeft.value = overflow && el.scrollLeft > 2;
  canScrollTabsRight.value = overflow && el.scrollLeft < max - 2;
}

function scrollTabsBy(dir: -1 | 1): void {
  const el = tabsBarRef.value;
  if (!el) return;
  const step = Math.max(120, Math.floor(el.clientWidth * 0.55));
  el.scrollBy({ left: dir * step, behavior: "smooth" });
}

function onTabsWheel(ev: WheelEvent): void {
  const el = tabsBarRef.value;
  if (!el || el.scrollWidth <= el.clientWidth + 2) return;
  const dx = ev.deltaX;
  const dy = ev.deltaY;
  // macOS trackpad often sends deltaX for horizontal swipes; map vertical wheel too.
  if (Math.abs(dx) > Math.abs(dy) && dx !== 0) {
    el.scrollLeft += dx;
    ev.preventDefault();
    updateTabsScrollState();
    return;
  }
  if (dy !== 0) {
    el.scrollLeft += dy;
    ev.preventDefault();
    updateTabsScrollState();
  }
}

function bindTabsScrollObservers(): void {
  tabsResizeObs?.disconnect();
  tabsResizeObs = null;
  const el = tabsBarRef.value;
  if (!el || typeof ResizeObserver === "undefined") {
    updateTabsScrollState();
    return;
  }
  tabsResizeObs = new ResizeObserver(() => updateTabsScrollState());
  tabsResizeObs.observe(el);
  updateTabsScrollState();
}

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
      // Pin may reshuffle store order vs Sortable DOM — rebind after paint.
      void nextTick(() => bindTabsSortable());
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
  void nextTick(() => {
    bindTabsSortable();
    bindTabsScrollObservers();
  });
  // Keep run list warm even when the Running tab is not active.
  agentRuns.bind();
  void agentRuns.refresh(workspace.root);

  offOpenBrowserTab = window.api.browser.onOpenTab((payload) => {
    try {
      if (layout.rightCollapsed) layout.rightCollapsed = false;
      const tab = rightTabs.addTab("browser");
      const url = (payload.url || "").trim();
      if (url && /^https?:\/\//i.test(url)) {
        rightTabs.patchTab(tab.id, { url });
        browserNav.requestNavigate(url, tab.id);
      }
      void window.api.browser.openTabAck({ requestId: payload.requestId, tabId: tab.id });
    } catch (err) {
      void window.api.browser.openTabAck({
        requestId: payload.requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  offCloseBrowserTab = window.api.browser.onCloseTab((payload) => {
    const id = (payload.tabId || "").trim();
    if (!id) return;
    rightTabs.closeTab(id);
  });
});

onUnmounted(() => {
  destroyTabsSortable();
  tabsResizeObs?.disconnect();
  tabsResizeObs = null;
  agentRuns.unbind();
  offOpenBrowserTab?.();
  offOpenBrowserTab = null;
  offCloseBrowserTab?.();
  offCloseBrowserTab = null;
});

watch(
  () => workspace.root,
  (root) => {
    void agentRuns.refresh(root);
  },
);

watch(
  () => rightTabs.tabs.map((tab) => tab.id).join("|"),
  () => {
    void nextTick(() => {
      bindTabsSortable();
      bindTabsScrollObservers();
      // Keep the newly appended / active tab visible at the end of the strip.
      const active = tabsBarRef.value?.querySelector<HTMLElement>(
        `.tab-item[data-id="${rightTabs.activeId}"]`,
      );
      active?.scrollIntoView({ inline: "nearest", block: "nearest" });
      updateTabsScrollState();
    });
  },
);

watch(
  () => rightTabs.activeId,
  () => {
    void nextTick(() => {
      const active = tabsBarRef.value?.querySelector<HTMLElement>(
        `.tab-item[data-id="${rightTabs.activeId}"]`,
      );
      active?.scrollIntoView({ inline: "nearest", block: "nearest" });
      updateTabsScrollState();
    });
  },
);

function iconFor(kind: RightTabKind) {
  switch (kind) {
    case "running":
      return PlayCircleOutline;
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
  const base = localizedTabLabel(tab);
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
    label: t.runningTab,
    key: "running",
    icon: () => h(NIcon, null, { default: () => h(PlayCircleOutline) }),
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
const runningCount = computed(() => agentRuns.runs.length);

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

const renameVisible = ref(false);
const renameDraft = ref("");
const renameTargetId = ref<string | null>(null);
const ctxMenuShow = ref(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuTabId = ref<string | null>(null);

const ctxMenuTab = computed(() =>
  rightTabs.tabs.find((tab) => tab.id === ctxMenuTabId.value) ?? null,
);

const ctxMenuOptions = computed(() =>
  ctxMenuTab.value ? tabContextOptions(ctxMenuTab.value) : [],
);

function canRenameTab(tab: RightTab): boolean {
  return (
    tab.kind === "browser" ||
    tab.kind === "terminal" ||
    tab.kind === "preview" ||
    tab.kind === "running" ||
    tab.kind === "changes"
  );
}

function openTabContextMenu(event: MouseEvent, tab: RightTab): void {
  // Deprecated legacy files tab has no rename/delete context menu
  if (tab.kind === "files") return;
  const options = tabContextOptions(tab);
  if (!options.length) return;
  ctxMenuTabId.value = tab.id;
  ctxMenuX.value = event.clientX;
  ctxMenuY.value = event.clientY;
  ctxMenuShow.value = true;
}

function closeTabContextMenu(): void {
  ctxMenuShow.value = false;
  ctxMenuTabId.value = null;
}

function tabContextOptions(tab: RightTab): DropdownOption[] {
  const options: DropdownOption[] = [];
  if (canRenameTab(tab)) {
    options.push({
      label: t.renameTab,
      key: "rename",
      icon: () => h(NIcon, null, { default: () => h(CreateOutline) }),
    });
  }
  if (tab.kind !== "running") {
    options.push({
      label: t.deleteTab,
      key: "delete",
      icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
    });
  }
  return options;
}

function onTabContextSelect(key: string | number): void {
  const tab = ctxMenuTab.value;
  closeTabContextMenu();
  if (!tab) return;
  const action = String(key);
  if (action === "rename") {
    if (!canRenameTab(tab)) return;
    renameTargetId.value = tab.id;
    renameDraft.value = tab.label;
    renameVisible.value = true;
    return;
  }
  if (action === "delete") {
    onTabClose(tab.id);
  }
}

function submitRenameTab(): void {
  const id = renameTargetId.value;
  const name = renameDraft.value.trim();
  if (!id || !name) {
    renameVisible.value = false;
    return;
  }
  rightTabs.renameTab(id, name);
  rightTabs.persistTabs(workspace.root);
  renameVisible.value = false;
  renameTargetId.value = null;
}
</script>

<template>
  <aside class="right-pane">
    <header class="head">
      <div class="tabs-row">
        <NButton
          class="tabs-scroll-btn pi-interactive"
          quaternary
          circle
          size="tiny"
          :disabled="!canScrollTabsLeft"
          :title="t.tabsScrollLeft"
          @click="scrollTabsBy(-1)"
        >
          <template #icon>
            <NIcon :component="ChevronBackOutline" :size="14" />
          </template>
        </NButton>

        <div
          ref="tabsBarRef"
          class="tabs-bar"
          :class="{
            'can-scroll-left': canScrollTabsLeft,
            'can-scroll-right': canScrollTabsRight,
          }"
          @scroll.passive="updateTabsScrollState"
          @wheel="onTabsWheel"
        >
          <div
            v-for="tab in rightTabs.tabs"
            :key="tab.id"
            class="tab-item"
            :class="{
              active: tab.id === rightTabs.activeId,
              'has-runs': tab.kind === 'running' && runningCount > 0,
            }"
            :data-id="tab.id"
            role="tab"
            :aria-selected="tab.id === rightTabs.activeId"
            @click="onTabChange(tab.id)"
            @contextmenu.prevent="openTabContextMenu($event, tab)"
          >
            <NIcon :component="iconFor(tab.kind)" :size="12" :style="tabLabelStyle(tab)" />
            <span
              class="tab-label"
              :class="{ transient: tab.kind === 'preview' && tab.transient !== false && !tab.dirty }"
              :style="tabLabelStyle(tab)"
            >{{ tabDisplayLabel(tab) }}</span>
            <span
              v-if="tab.kind === 'running' && runningCount > 0"
              class="tab-run-count"
            >{{ runningCount }}</span>
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

        <NButton
          class="tabs-scroll-btn pi-interactive"
          quaternary
          circle
          size="tiny"
          :disabled="!canScrollTabsRight"
          :title="t.tabsScrollRight"
          @click="scrollTabsBy(1)"
        >
          <template #icon>
            <NIcon :component="ChevronForwardOutline" :size="14" />
          </template>
        </NButton>

        <NDropdown trigger="click" :options="addOptions" @select="onAddSelect">
          <NButton quaternary circle size="tiny" class="pi-interactive" :title="t.newTab">
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
              <PanelRightIcon :size="15" />
            </template>
          </NButton>
        </template>
        {{ t.collapseRight }}
      </NTooltip>
    </header>

    <div class="body">
      <template v-for="tab in rightTabs.tabs" :key="tab.id">
        <RunningTab
          v-if="tab.kind === 'running'"
          v-show="active?.id === tab.id"
          class="tab-panel"
          :visible="active?.id === tab.id && !layout.rightCollapsed"
        />
        <ChangesTab
          v-if="tab.kind === 'changes'"
          v-show="active?.id === tab.id"
          class="tab-panel"
          :visible="active?.id === tab.id && !layout.rightCollapsed"
        />
        <BrowserTab
          v-if="tab.kind === 'browser'"
          v-show="active?.id === tab.id"
          class="tab-panel"
          :tab-id="tab.id"
          :initial-url="tab.url ?? null"
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
        v-if="!active"
        :description="rightTabs.tabs.length ? t.selectTabHint : t.clickToAddTab"
        class="empty"
        size="small"
      />
    </div>

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctxMenuX"
      :y="ctxMenuY"
      :options="ctxMenuOptions"
      :show="ctxMenuShow"
      @clickoutside="closeTabContextMenu"
      @select="onTabContextSelect"
    />

    <NModal
      v-model:show="renameVisible"
      preset="card"
      :title="t.renameTab"
      style="width: 360px"
      :mask-closable="true"
    >
      <p class="rename-hint">{{ t.renameTabPrompt }}</p>
      <NInput
        v-model:value="renameDraft"
        :placeholder="t.renameTabPlaceholder"
        @keydown.enter.prevent="submitRenameTab"
      />
      <template #footer>
        <NSpace justify="end">
          <NButton size="small" @click="renameVisible = false">{{ t.cancel }}</NButton>
          <NButton size="small" type="primary" @click="submitRenameTab">{{ t.confirm }}</NButton>
        </NSpace>
      </template>
    </NModal>
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
  min-height: 34px;
  height: 34px;
  padding: 0 6px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-panel) 92%, var(--bg-elevated));
  flex-shrink: 0;
  position: relative;
  z-index: 6;
}

.collapse-btn {
  flex-shrink: 0;
  position: relative;
  z-index: 7;
}

.collapse-btn:active {
  transform: none !important;
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

.tabs-scroll-btn {
  flex-shrink: 0;
  color: var(--fg-muted);
}

.tabs-scroll-btn:disabled {
  opacity: 0.28;
  pointer-events: none;
}

.tabs-scroll-btn:active {
  transform: none !important;
}

.tabs-bar {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  height: 100%;
  scrollbar-width: none;
  overscroll-behavior-x: contain;
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 var(--tabs-fade-left, 0px),
    #000 calc(100% - var(--tabs-fade-right, 0px)),
    transparent 100%
  );
  --tabs-fade-left: 0px;
  --tabs-fade-right: 0px;
}

.tabs-bar.can-scroll-left {
  --tabs-fade-left: 10px;
}

.tabs-bar.can-scroll-right {
  --tabs-fade-right: 10px;
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

.tab-item.has-runs {
  background: color-mix(in srgb, #eab308 22%, var(--bg));
  border-color: color-mix(in srgb, #eab308 40%, var(--border));
  color: color-mix(in srgb, #854d0e 55%, var(--fg));
}

.tab-item.has-runs:hover {
  background: color-mix(in srgb, #eab308 30%, var(--bg-hover));
  color: color-mix(in srgb, #854d0e 45%, var(--fg));
}

.tab-item.has-runs.active {
  background: color-mix(in srgb, #eab308 34%, var(--bg-elevated));
  border-color: color-mix(in srgb, #eab308 50%, var(--border));
  color: color-mix(in srgb, #713f12 40%, var(--fg-strong));
  box-shadow: var(--shadow-sm);
}

.tab-run-count {
  flex-shrink: 0;
  min-width: 14px;
  padding: 0 4px;
  border-radius: 999px;
  background: color-mix(in srgb, #ca8a04 28%, transparent);
  color: inherit;
  font-size: 10px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  line-height: 14px;
  text-align: center;
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

.rename-hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--text-muted, #71717a);
}
</style>
