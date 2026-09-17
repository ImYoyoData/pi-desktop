<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { NButton, NInput, NModal, NSpin, NSpace, useDialog, useMessage } from "naive-ui";
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
import type { AgentIssueCode, SkillIssueCode } from "../../../shared/customizations";

const props = defineProps<{
  section: string;
  visible: boolean;
}>();

type CodiconName = InstanceType<typeof CodiconIcon>["$props"]["name"];

interface CustomizeSectionEntry {
  id: string;
  icon: CodiconName;
  label: string;
  description: string;
}

const sections = computed<CustomizeSectionEntry[]>(() => [
  { id: "general", icon: "settings", label: t.customizeGeneral, description: t.customizeGeneralDesc },
  { id: "appearance", icon: "appearance", label: t.customizeAppearance, description: t.customizeAppearanceDesc },
  { id: "models", icon: "models", label: t.customizeModels, description: t.customizeModelsDesc },
  { id: "agents", icon: "agents", label: t.customizeAgents, description: t.customizeAgentsDesc },
  { id: "skills", icon: "skills", label: t.customizeSkills, description: t.customizeSkillsDesc },
  { id: "instructions", icon: "instructions", label: t.customizeInstructions, description: t.customizeInstructionsDesc },
  { id: "hooks", icon: "hooks", label: t.customizeHooks, description: t.customizeHooksDesc },
  { id: "mcp", icon: "mcp", label: t.customizeMcp, description: t.customizeMcpDesc },
  { id: "plugins", icon: "plugins", label: t.customizePlugins, description: t.customizePluginsDesc },
  { id: "tools", icon: "tools", label: t.customizeTools, description: t.customizeToolsDesc },
  { id: "about", icon: "about", label: t.aboutTitle, description: t.customizeAboutDesc },
]);

/** VS Code 侧栏常量：默认 200px，可拖拽 150–350。 */
const SIDEBAR_DEFAULT_WIDTH = 200;
const SIDEBAR_MIN_WIDTH = 150;
const SIDEBAR_MAX_WIDTH = 350;
const WIDTH_KEY = "pi-desktop:customize-sidebar-width:v1";

const store = useCustomizationsStore();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();

/** 旧版本持久化的失效页签（如已移除的「提示」）回落到常规页。 */
function resolveSection(id: string): string {
  return sections.value.some((entry) => entry.id === id) ? id : "general";
}

const active = ref(resolveSection(props.section));
const modal = ref<string | null>(null);
const width = ref(readWidth());
/** 页内编辑目标：已有文件或未落盘的草稿（技能/智能体/指令）。 */
type DraftKind = "skills" | "agents" | "instructions";
type EditingTarget =
  | { kind: "file"; filePath: string; title: string; rename: boolean }
  | { kind: "draft"; draftKind: DraftKind; scope: "user" | "project"; workspace: string | null };

/** 各类草稿的初始内容：指令是纯 markdown，技能与智能体带 frontmatter。 */
const DRAFT_TEMPLATES: Record<DraftKind, string> = {
  skills: ["---", "name: ", 'description: ""', "---", ""].join("\n"),
  agents: ["---", "name: ", 'description: ""', "---", ""].join("\n"),
  instructions: "",
};

const editing = ref<EditingTarget | null>(null);
const editorRef = ref<InstanceType<typeof PreviewTab> | null>(null);
const editorDirty = computed(() => editorRef.value?.dirty === true);
const message = useMessage();
const dialog = useDialog();
const editorName = ref("");
const nameInput = ref<InstanceType<typeof NInput> | null>(null);

const draftTarget = computed(() => (editing.value?.kind === "draft" ? editing.value : null));
const editorTitle = computed(() => {
  const target = editing.value;
  if (!target) return "";
  if (target.kind === "file") return target.title;
  return target.draftKind === "instructions" ? t.customizeNewInstructions : "";
});
/** 标题可编辑：技能/智能体草稿可改名，指令文件名固定；已保存技能/智能体按列表来源可改名。 */
const nameEditable = computed(() => {
  const target = editing.value;
  if (!target) return false;
  if (target.kind === "draft") return target.draftKind !== "instructions";
  return target.rename;
});
const editorFilePath = computed(() =>
  editing.value?.kind === "file" ? editing.value.filePath : null,
);
const editorDraftContent = computed(() =>
  draftTarget.value ? DRAFT_TEMPLATES[draftTarget.value.draftKind] : null,
);
/** 重命名预览：路径行实时显示改名后的完整路径，保存后才真正生效。 */
const editorFilePathPreview = computed(() => {
  const target = editing.value;
  if (!target || target.kind !== "file") return null;
  const next = editorName.value.trim();
  if (!target.rename || !next || next === target.title) return target.filePath;
  const sep = target.filePath.includes("\\") ? "\\" : "/";
  if (listKind.value === "agents") {
    const file = `${sep}${target.title}.md`;
    return target.filePath.includes(file)
      ? target.filePath.replace(file, `${sep}${next}.md`)
      : target.filePath;
  }
  const marker = `${sep}${target.title}${sep}`;
  return target.filePath.includes(marker)
    ? target.filePath.replace(marker, `${sep}${next}${sep}`)
    : target.filePath;
});
/** 标题改名也算未保存改动，保存按钮一并高亮。 */
const nameChanged = computed(() => {
  const target = editing.value;
  if (!target || target.kind !== "file" || !target.rename) return false;
  const next = editorName.value.trim();
  return Boolean(next) && next !== target.title;
});
const editorDirtyTotal = computed(() => editorDirty.value || nameChanged.value);
/** 草稿创建后的完整路径（页头路径行展示，跟随名称输入实时变化）。 */
const draftLocation = computed(() => {
  const draft = draftTarget.value;
  if (!draft) return "";
  if (draft.scope === "project" && draft.workspace) {
    const sep = draft.workspace.includes("\\") ? "\\" : "/";
    const base = `${draft.workspace}${sep}.pi`;
    if (draft.draftKind === "instructions") return `${draft.workspace}${sep}AGENTS.md`;
    if (draft.draftKind === "agents") {
      const name = editorName.value.trim() || "new-agent";
      return `${base}${sep}agents${sep}${name}.md`;
    }
    const name = editorName.value.trim() || "new-skill";
    return `${base}${sep}skills${sep}${name}${sep}SKILL.md`;
  }
  if (draft.draftKind === "instructions") return "~/.pi/agent/AGENTS.md";
  if (draft.draftKind === "agents") {
    const name = editorName.value.trim() || "new-agent";
    return `~/.pi/agent/agents/${name}.md`;
  }
  const name = editorName.value.trim() || "new-skill";
  return `~/.pi/agent/skills/${name}/SKILL.md`;
});

const current = computed(
  () => sections.value.find((entry) => entry.id === active.value) ?? sections.value[0],
);

const LIST_KINDS = ["agents", "skills", "instructions", "mcp", "plugins"] as const;
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
  leaveEditor(() => {
    active.value = id;
    layout.setCustomizeSection(id);
  });
}

function openInPage(payload: { filePath: string; title: string; rename: boolean }): void {
  editorName.value = payload.title;
  editing.value = {
    kind: "file",
    filePath: payload.filePath,
    title: payload.title,
    rename: payload.rename,
  };
}

function openDraft(payload: {
  kind: DraftKind;
  scope: "user" | "project";
  workspace: string | null;
}): void {
  editorName.value = "";
  editing.value = {
    kind: "draft",
    draftKind: payload.kind,
    scope: payload.scope,
    workspace: payload.workspace,
  };
  if (payload.kind !== "instructions") {
    void nextTick(() => nameInput.value?.focus());
  }
}

function draftTitle(kind: DraftKind): string {
  switch (kind) {
    case "agents":
      return t.customizeNewAgent;
    case "instructions":
      return t.customizeNewInstructions;
    default:
      return t.customizeNewSkill;
  }
}

/** 草稿态：标题即名称，实时同步正文 frontmatter 的 name 行（指令无 frontmatter）。 */
function onEditorNameInput(value: string): void {
  const draft = draftTarget.value;
  if (!draft || draft.draftKind === "instructions") return;
  const editor = editorRef.value;
  if (!editor) return;
  const content = editor.getContent();
  const updated = content.replace(/^(name:[ \t]*).*$/m, `$1${value}`);
  if (updated !== content) editor.setContent(updated);
}

async function saveSkillDraft(content: string): Promise<boolean> {
  const draft = draftTarget.value;
  if (!draft) return false;
  if (draft.scope === "project" && !draft.workspace) {
    message.error(t.slashNeedWorkspace);
    return false;
  }
  try {
    const saved = await window.api.skills.createFromDraft(
      content,
      draft.scope,
      draft.scope === "project" ? draft.workspace ?? undefined : undefined,
    );
    if (!saved.ok) {
      message.error(skillIssuesText(saved.issues));
      return false;
    }
    await store.load(true);
    editing.value = { kind: "file", filePath: saved.filePath, title: saved.name, rename: true };
    editorName.value = saved.name;
    message.success(t.saved);
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function saveAgentDraft(content: string): Promise<boolean> {
  const draft = draftTarget.value;
  if (!draft) return false;
  try {
    const saved = await window.api.customizations.createAgentFromDraft(
      content,
      draft.scope,
      draft.scope === "project" ? draft.workspace ?? undefined : undefined,
    );
    if (!saved.ok) {
      message.error(agentIssueText(saved.code));
      return false;
    }
    await store.load(true);
    editing.value = { kind: "file", filePath: saved.filePath, title: saved.name, rename: true };
    editorName.value = saved.name;
    message.success(t.saved);
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function saveInstructionsDraft(content: string): Promise<boolean> {
  const draft = draftTarget.value;
  if (!draft) return false;
  try {
    const saved = await window.api.customizations.createInstructionsFromDraft(
      content,
      draft.scope,
      draft.scope === "project" ? draft.workspace ?? undefined : undefined,
    );
    if (!saved.ok) {
      message.error(t.instructionsExists);
      return false;
    }
    await store.load(true);
    editing.value = { kind: "file", filePath: saved.filePath, title: "AGENTS.md", rename: false };
    message.success(t.saved);
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function agentIssueText(code: AgentIssueCode): string {
  switch (code) {
    case "name-required":
      return t.agentNameRequired;
    case "name-invalid":
      return t.agentNameInvalid;
    default:
      return t.agentAlreadyExists;
  }
}

/** 已保存文件落盘：技能走 skills.save（校验 + 改名），智能体走 saveAgent，其余直接写盘。 */
async function saveFileTarget(
  target: Extract<EditingTarget, { kind: "file" }>,
  content: string,
): Promise<boolean> {
  const kind = listKind.value;
  const nextName = editorName.value.trim();
  const shouldRename = Boolean(nextName) && nextName !== target.title;
  if (kind === "skills" && target.rename) {
    try {
      const saved = await window.api.skills.save(
        target.filePath,
        content,
        shouldRename ? nextName : undefined,
        workspace.root ?? undefined,
      );
      if (!saved.ok) {
        message.error(skillIssuesText(saved.issues));
        return false;
      }
      await store.load(true);
      editing.value = { kind: "file", filePath: saved.filePath, title: saved.name, rename: true };
      editorName.value = saved.name;
      message.success(t.saved);
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }
  if (kind === "agents" && target.rename) {
    try {
      const saved = await window.api.customizations.saveAgent(
        target.filePath,
        content,
        shouldRename ? nextName : undefined,
        workspace.root ?? undefined,
      );
      if (!saved.ok) {
        message.error(agentIssueText(saved.code));
        return false;
      }
      await store.load(true);
      editing.value = { kind: "file", filePath: saved.filePath, title: saved.name, rename: true };
      editorName.value = saved.name;
      message.success(t.saved);
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    }
  }
  try {
    await window.api.preview.write(target.filePath, content);
    await store.load(true);
    message.success(t.saved);
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

function skillIssueText(code: SkillIssueCode): string {
  switch (code) {
    case "name-required":
      return t.skillIssueNameRequired;
    case "name-invalid":
      return t.skillIssueNameInvalid;
    case "name-too-long":
      return t.skillIssueNameTooLong;
    case "description-required":
      return t.skillIssueDescriptionRequired;
    default:
      return t.skillIssueDescriptionTooLong;
  }
}

/** 多条规范问题合并提示。 */
function skillIssuesText(issues: SkillIssueCode[]): string {
  return issues.map(skillIssueText).join("；");
}

/** 保存按钮与 Ctrl+S 统一入口。 */
async function saveEditorContent(content: string): Promise<boolean> {
  const target = editing.value;
  if (!target) return false;
  if (target.kind === "draft") {
    switch (target.draftKind) {
      case "skills":
        return saveSkillDraft(content);
      case "agents":
        return saveAgentDraft(content);
      default:
        return saveInstructionsDraft(content);
    }
  }
  return saveFileTarget(target, content);
}

function saveEditingFile(): void {
  void editorRef.value?.save();
}

/** 离开编辑器前：有未保存改动时询问保存 / 不保存 / 取消。 */
function leaveEditor(onLeave: () => void): void {
  const target = editing.value;
  if (!target) {
    onLeave();
    return;
  }
  if (!editorDirtyTotal.value) {
    editing.value = null;
    onLeave();
    return;
  }
  const label =
    target.kind === "file" ? target.title : editorName.value.trim() || draftTitle(target.draftKind);
  const d = dialog.create({
    title: t.unsavedChangesTitle,
    content: t.unsavedChangesClose(label),
    closable: true,
    maskClosable: false,
    closeOnEsc: true,
    action: () =>
      h(
        NSpace,
        { justify: "end", size: 8 },
        {
          default: () => [
            h(NButton, { size: "small", onClick: () => d.destroy() }, { default: () => t.cancel }),
            h(
              NButton,
              {
                size: "small",
                onClick: () => {
                  d.destroy();
                  editing.value = null;
                  onLeave();
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
                    const ok = await editorRef.value?.save();
                    if (!ok) return;
                    d.destroy();
                    editing.value = null;
                    onLeave();
                  })();
                },
              },
              { default: () => t.save },
            ),
          ],
        },
      ),
  });
}

function closeEditor(): void {
  leaveEditor(() => {});
}

/** 编辑器页头删除：草稿直接丢弃，文件按当前列表类型删除。 */
const canDeleteEditing = computed(() => {
  const target = editing.value;
  if (!target) return false;
  if (target.kind === "draft") return true;
  return listKind.value === "skills" || listKind.value === "agents";
});

function deleteEditing(): void {
  const target = editing.value;
  if (!target) return;
  if (target.kind === "draft") {
    dialog.warning({
      title: t.customizeDelete,
      content: t.customizeDiscardDraftConfirm,
      positiveText: t.customizeDelete,
      negativeText: t.cancel,
      onPositiveClick: () => {
        editing.value = null;
      },
    });
    return;
  }
  if (!canDeleteEditing.value) return;
  const kind = listKind.value;
  dialog.create({
    title: t.customizeDelete,
    content:
      kind === "agents"
        ? t.customizeDeleteConfirm(target.title)
        : t.customizeUninstallConfirm(target.title),
    positiveText: t.customizeDelete,
    negativeText: t.cancel,
    positiveButtonProps: { type: "primary" },
    onPositiveClick: async () => {
      try {
        if (kind === "skills") {
          await window.api.skills.uninstall(target.filePath, workspace.root ?? undefined);
        } else {
          await window.api.customizations.removeItem(
            target.filePath,
            workspace.root ?? undefined,
          );
        }
        await store.load(true);
        editing.value = null;
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
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
    if (!value) return;
    const next = resolveSection(value);
    if (next !== active.value) {
      editing.value = null;
      active.value = next;
    }
  },
);

watch(
  () => props.visible,
  (value) => {
    if (value) void store.load(true);
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
  if (props.visible) void store.load(true);
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
            v-for="entry in sections"
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
            <NInput
              v-if="nameEditable"
              ref="nameInput"
              v-model:value="editorName"
              size="small"
              class="editor-name-input"
              :placeholder="t.customizeNewSkill"
              @update:value="onEditorNameInput"
            />
            <h2 v-else class="editor-heading-title">{{ editorTitle }}</h2>
            <p
              v-if="editorFilePathPreview"
              class="editor-heading-path"
              :title="editorFilePathPreview"
            >
              {{ editorFilePathPreview }}
            </p>
            <p v-else class="editor-heading-path" :title="draftLocation">{{ draftLocation }}</p>
          </div>
          <div class="editor-actions">
            <button
              type="button"
              class="editor-action"
              :class="{ primary: editorDirtyTotal }"
              :title="t.saveShortcut"
              :aria-label="t.save"
              @click="saveEditingFile"
            >
              {{ t.save }}
            </button>
            <button
              v-if="canDeleteEditing"
              type="button"
              class="editor-action remove"
              :title="t.customizeDelete"
              :aria-label="t.customizeDelete"
              @click="deleteEditing"
            >
              {{ t.customizeDelete }}
            </button>
          </div>
        </header>
        <div class="embedded-editor">
          <PreviewTab
            ref="editorRef"
            :file-path="editorFilePath"
            :draft-content="editorDraftContent"
            :save-handler="saveEditorContent"
            :active="true"
            embedded
          />
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
          @new-draft="openDraft"
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

.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-back-button {
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
  color: var(--fg-muted);
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.editor-back-button:hover {
  background-color: var(--bg-hover);
  color: var(--fg);
}

.editor-back-button:focus-visible,
.editor-action:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

/* 描边小按钮：与模型设置页的「启用 / 删除」同款 */
.editor-action {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 11.5px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease;
}

.editor-action:hover {
  background: var(--bg-active);
  color: var(--fg);
}

.editor-action.primary,
.editor-action.primary:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
  color: var(--fg-strong);
}

.editor-action.primary:hover {
  background: var(--accent-soft-hover);
}

.editor-action.remove:hover {
  background: color-mix(in srgb, var(--error) 14%, transparent);
  color: var(--fg);
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

.editor-name-input {
  max-width: 320px;
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
