<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NModal, NSpin } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import PreviewTab from "@renderer/components/PreviewTab.vue";
import AppearancePanel from "@renderer/components/AppearancePanel.vue";
import AboutPanel from "@renderer/components/AboutPanel.vue";
import CustomizeGeneral from "@renderer/components/customize/CustomizeGeneral.vue";
import CustomizeSection from "@renderer/components/customize/CustomizeSection.vue";
import CustomizeHooks from "@renderer/components/customize/CustomizeHooks.vue";
import CustomizeTools from "@renderer/components/customize/CustomizeTools.vue";
import CustomizeModels from "@renderer/components/customize/CustomizeModels.vue";
import NotifySettings from "@renderer/components/NotifySettings.vue";
import AsrSettings from "@renderer/components/AsrSettings.vue";
import SecuritySettings from "@renderer/components/SecuritySettings.vue";
import ProxySettings from "@renderer/components/ProxySettings.vue";
import MarketSettings from "@renderer/components/MarketSettings.vue";
import LanConsoleSettings from "@renderer/components/LanConsoleSettings.vue";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const props = defineProps<{
  section: string;
  visible: boolean;
}>();

type CodiconName = InstanceType<typeof CodiconIcon>["$props"]["name"];

const SECTIONS = [
  { id: "general", icon: "settings", label: t.customizeGeneral, description: t.customizeGeneralDesc },
  { id: "appearance", icon: "appearance", label: t.customizeAppearance, description: t.customizeAppearanceDesc },
  { id: "models", icon: "models", label: t.customizeModels, description: t.customizeModelsDesc },
  { id: "agents", icon: "agents", label: t.customizeAgents, description: t.customizeAgentsDesc },
  { id: "skills", icon: "skills", label: t.customizeSkills, description: t.customizeSkillsDesc },
  { id: "instructions", icon: "instructions", label: t.customizeInstructions, description: t.customizeInstructionsDesc },
  { id: "prompts", icon: "prompts", label: t.customizePrompts, description: t.customizePromptsDesc },
  { id: "hooks", icon: "hooks", label: t.customizeHooks, description: t.customizeHooksDesc },
  { id: "mcp", icon: "mcp", label: t.customizeMcp, description: t.customizeMcpDesc },
  { id: "plugins", icon: "plugins", label: t.customizePlugins, description: t.customizePluginsDesc },
  { id: "tools", icon: "tools", label: t.customizeTools, description: t.customizeToolsDesc },
  { id: "about", icon: "about", label: t.aboutTitle, description: t.customizeAboutDesc },
] as const satisfies ReadonlyArray<{
  id: string;
  icon: CodiconName;
  label: string;
  description: string;
}>;

/** VS Code 侧栏常量：默认 200px，可拖拽 150–350。 */
const SIDEBAR_DEFAULT_WIDTH = 200;
const SIDEBAR_MIN_WIDTH = 150;
const SIDEBAR_MAX_WIDTH = 350;
const WIDTH_KEY = "pi-desktop:customize-sidebar-width:v1";

const store = useCustomizationsStore();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();

const active = ref(props.section || "general");
const modal = ref<string | null>(null);
const width = ref(readWidth());
/** 页内打开的定制项文件（VS Code 内嵌编辑器形态）。 */
const editing = ref<{ filePath: string; title: string } | null>(null);
const editorRef = ref<InstanceType<typeof PreviewTab> | null>(null);
const editorDirty = computed(() => editorRef.value?.dirty === true);

const current = computed(
  () => SECTIONS.find((entry) => entry.id === active.value) ?? SECTIONS[0],
);

const LIST_KINDS = ["agents", "skills", "instructions", "prompts", "mcp", "plugins"] as const;
type ListKind = (typeof LIST_KINDS)[number];

const listKind = computed<ListKind>(() =>
  (LIST_KINDS as readonly string[]).includes(active.value) ? (active.value as ListKind) : "agents",
);

const listItems = computed(() => {
  const snapshot = store.snapshot;
  switch (listKind.value) {
    case "skills":
      return snapshot.skills;
    case "instructions":
      return snapshot.instructions;
    case "prompts":
      return snapshot.prompts;
    case "mcp":
      return snapshot.mcp;
    case "plugins":
      return snapshot.plugins;
    default:
      return snapshot.agents;
  }
});

const counts = computed<Record<string, number>>(() => ({
  agents: store.snapshot.agents.length,
  skills: store.snapshot.skills.length,
  instructions: store.snapshot.instructions.length,
  prompts: store.snapshot.prompts.length,
  hooks: store.snapshot.hooks.length,
  mcp: store.snapshot.mcp.length,
  plugins: store.snapshot.plugins.length,
  tools: store.snapshot.tools.length,
}));

function readWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return SIDEBAR_DEFAULT_WIDTH;
  return Math.min(Math.max(raw, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function selectSection(id: string): void {
  editing.value = null;
  active.value = id;
  layout.setCustomizeSection(id);
}

function openInPage(payload: { filePath: string; title: string }): void {
  editing.value = payload;
}

function saveEditingFile(): void {
  void editorRef.value?.save();
}

function closeEditor(): void {
  editing.value = null;
}

function onResizeStart(event: MouseEvent): void {
  const startX = event.clientX;
  const startWidth = width.value;
  const onMove = (move: MouseEvent) => {
    width.value = Math.min(
      Math.max(startWidth + move.clientX - startX, SIDEBAR_MIN_WIDTH),
      SIDEBAR_MAX_WIDTH,
    );
  };
  const onUp = () => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    localStorage.setItem(WIDTH_KEY, String(width.value));
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

watch(
  () => props.section,
  (value) => {
    if (value && value !== active.value) {
      editing.value = null;
      active.value = value;
    }
  },
);

watch(
  () => props.visible,
  (value) => {
    if (value) void store.load();
    else modal.value = null;
  },
);

watch(
  () => workspace.root,
  () => {
    if (props.visible) void store.load(true);
  },
);

onMounted(() => {
  if (props.visible) void store.load();
});

onUnmounted(() => {
  modal.value = null;
});
</script>

<template>
  <div class="ai-customization-management-editor">
    <aside class="management-sidebar" :style="{ width: `${width}px` }">
      <div class="sidebar-content">
        <div class="sidebar-sections-list" role="tablist">
          <button
            v-for="entry in SECTIONS"
            :key="entry.id"
            type="button"
            role="tab"
            class="section-list-item"
            :class="{ selected: entry.id === active }"
            :aria-selected="entry.id === active"
            :title="entry.description"
            @click="selectSection(entry.id)"
          >
            <span class="section-icon"><CodiconIcon :name="entry.icon" :size="16" /></span>
            <span class="section-label">{{ entry.label }}</span>
            <span v-if="counts[entry.id]" class="section-count">{{ counts[entry.id] }}</span>
          </button>
        </div>
      </div>
    </aside>

    <div
      class="management-sash"
      role="separator"
      aria-orientation="vertical"
      @mousedown.prevent="onResizeStart"
    />

    <section class="management-content">
      <div v-if="editing" class="content-inner editor-inner">
        <header class="editor-page-header">
          <button
            type="button"
            class="editor-back-button"
            :title="t.customizeBackToList"
            :aria-label="t.customizeBackToList"
            @click="closeEditor"
          >
            <CodiconIcon name="back" :size="16" />
          </button>
          <div class="editor-heading">
            <h2 class="editor-heading-title">{{ editing.title }}</h2>
            <p class="editor-heading-path" :title="editing.filePath">{{ editing.filePath }}</p>
          </div>
          <button
            type="button"
            class="editor-save-button"
            :class="{ dirty: editorDirty }"
            :title="t.saveShortcut"
            :aria-label="t.save"
            @click="saveEditingFile"
          >
            <CodiconIcon name="check" :size="16" />
          </button>
        </header>
        <div class="embedded-editor">
          <PreviewTab ref="editorRef" :file-path="editing.filePath" :active="true" embedded />
        </div>
      </div>

      <div v-else class="content-inner">
        <div class="section-title-header">
          <div class="section-title-row">
            <h2 class="section-title">{{ current.label }}</h2>
          </div>
        </div>

        <p v-if="store.error" class="content-error">
          {{ t.customizeLoadFailed }}: {{ store.error }}
        </p>

        <NSpin v-if="store.loading" size="small" class="content-spin" />

        <CustomizeGeneral v-else-if="active === 'general'" @open="modal = $event" />

        <AppearancePanel v-else-if="active === 'appearance'" />

        <AboutPanel v-else-if="active === 'about'" />

        <CustomizeModels v-else-if="active === 'models'" />

        <CustomizeHooks v-else-if="active === 'hooks'" :hooks="store.snapshot.hooks" />

        <CustomizeTools v-else-if="active === 'tools'" :tools="store.snapshot.tools" />

        <CustomizeSection
          v-else
          :kind="listKind"
          :items="listItems"
          @refresh="store.load(true)"
          @market="modal = 'market'"
          @open="openInPage"
        />
      </div>
    </section>

    <NotifySettings :open="modal === 'notify'" @close="modal = null" />
    <AsrSettings :open="modal === 'voice'" @close="modal = null" />
    <SecuritySettings :open="modal === 'security'" @close="modal = null" />
    <ProxySettings :open="modal === 'proxy'" @close="modal = null" />
    <MarketSettings :open="modal === 'market'" @close="modal = null" />
    <NModal
      :show="modal === 'lan'"
      preset="card"
      class="pi-settings-modal"
      style="width: min(520px, 92vw)"
      :title="t.lanConsoleTitle"
      :bordered="false"
      @update:show="(value) => !value && (modal = null)"
    >
      <LanConsoleSettings @close="modal = null" />
    </NModal>
  </div>
</template>

<style scoped>
.ai-customization-management-editor {
  display: flex;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
  color: var(--fg);
  font-size: 13px;
}

.management-sidebar {
  flex-shrink: 0;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.sidebar-content {
  height: 100%;
  box-sizing: border-box;
  padding: 0 12px 4px 4px;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.sidebar-sections-list {
  flex: 0 0 auto;
  overflow: hidden;
  padding-top: 4px;
}

.section-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 26px;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: 12px;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.1s ease, opacity 0.1s ease;
}

.section-list-item:hover {
  background-color: var(--bg-hover);
}

.section-list-item.selected {
  background-color: var(--bg-active);
}

.section-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  opacity: 0.85;
}

.section-list-item.selected .section-icon {
  opacity: 1;
}

.section-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-count {
  flex-shrink: 0;
  min-width: 14px;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  text-align: right;
}

.section-list-item.selected .section-count {
  color: inherit;
}

.management-sash {
  flex-shrink: 0;
  width: 1px;
  background: var(--border);
  cursor: col-resize;
  transition: background-color 0.1s ease;
}

.management-sash:hover {
  background: var(--border-strong);
}

.management-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg);
}

.content-inner {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding-right: 16px;
  padding-bottom: 16px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.content-inner > :not(.content-error):not(.content-spin):not(.embedded-editor):not(.editor-page-header) {
  width: min(calc(100% - 80px), 840px);
  margin-inline: auto;
}

/* 页内编辑器（点击「打开」后在页面内打开，不占用侧栏） */
.editor-inner {
  padding: 0;
  overflow: hidden;
}

.editor-page-header {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 14px 14px 14px 6px;
  border-bottom: 1px solid var(--border);
}

.editor-back-button,
.editor-save-button {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  opacity: 0.6;
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease, opacity 0.1s ease;
}

.editor-back-button:hover,
.editor-save-button:hover {
  background-color: var(--bg-hover);
  opacity: 1;
}

.editor-save-button.dirty {
  color: var(--accent);
  opacity: 1;
}

.editor-back-button:focus-visible,
.editor-save-button:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.editor-heading {
  min-width: 0;
}

.editor-heading-title {
  margin: 0;
  overflow: hidden;
  color: var(--fg);
  font-size: 16px;
  font-weight: 600;
  line-height: 22px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-heading-path {
  margin: 2px 0 0;
  overflow: hidden;
  color: var(--fg-muted);
  font-size: 11.5px;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.embedded-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.embedded-editor > :deep(.preview-tab) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.section-title-header {
  flex-shrink: 0;
  padding: 16px 0 0;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 12px;
}

.section-title {
  margin: 0;
  color: var(--fg);
  font-size: 18px;
  font-weight: 600;
}

.content-error {
  margin: 0;
  color: var(--error);
  font-size: 12px;
}

.content-spin {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}
</style>
