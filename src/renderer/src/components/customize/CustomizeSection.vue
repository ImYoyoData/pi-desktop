<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { NButton, NDropdown, NInput, NSwitch, useDialog, useMessage } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import McpAddModal from "@renderer/components/customize/McpAddModal.vue";
import SkillAddModal from "@renderer/components/customize/SkillAddModal.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { usePluginUpdatesStore } from "@renderer/stores/plugin-updates";
import type {
  CustomizationCreateKind,
  CustomizationItem,
  CustomizationScope,
  McpTestResult,
} from "../../../../shared/customizations";
import type { PluginUpdateProgress, PluginVersionInfo } from "../../../../shared/pi-market";
import { t } from "@renderer/i18n";

type SectionKind = "agents" | "skills" | "instructions" | "prompts" | "mcp" | "plugins";

const props = defineProps<{
  kind: SectionKind;
  items: CustomizationItem[];
}>();

const emit = defineEmits<{
  refresh: [];
  market: [];
  open: [payload: { filePath: string; title: string }];
}>();

const workspace = useWorkspaceStore();
const store = useCustomizationsStore();
const dialog = useDialog();
const message = useMessage();

const query = ref("");
const addOpen = ref(false);
const skillAddOpen = ref(false);
const mcpTesting = ref(false);
const mcpTestResults = ref<Record<string, McpTestResult>>({});
const pluginUpdates = usePluginUpdatesStore();
const collapsed = reactive(new Set<CustomizationScope>());

/** 右键菜单（对应 VS Code 的行上下文菜单）。 */
const ctx = reactive<{
  show: boolean;
  x: number;
  y: number;
  item: CustomizationItem | null;
}>({ show: false, x: 0, y: 0, item: null });

const GROUP_ORDER: CustomizationScope[] = ["project", "user", "builtin", "extension"];

function groupLabel(scope: CustomizationScope): string {
  switch (scope) {
    case "project":
      return t.customizeGroupProject;
    case "user":
      return t.customizeGroupUser;
    case "builtin":
      return t.customizeGroupBuiltin;
    default:
      return t.customizeGroupExtension;
  }
}

function groupHint(scope: CustomizationScope): string {
  switch (scope) {
    case "project":
      return t.customizeGroupProjectHint;
    case "user":
      return t.customizeGroupUserHint;
    case "builtin":
      return t.customizeGroupBuiltinHint;
    default:
      return t.customizeGroupExtensionHint;
  }
}

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.items;
  return props.items.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.description.toLowerCase().includes(needle) ||
      (item.detail ?? "").toLowerCase().includes(needle),
  );
});

const grouped = computed(() =>
  GROUP_ORDER.map((scope) => ({
    scope,
    label: groupLabel(scope),
    hint: groupHint(scope),
    items: filtered.value.filter((item) => item.scope === scope),
  })).filter((group) => group.items.length > 0),
);

const emptyLabel = computed(() => {
  switch (props.kind) {
    case "agents":
      return t.customizeAgents;
    case "skills":
      return t.customizeSkills;
    case "instructions":
      return t.customizeInstructions;
    case "prompts":
      return t.customizePrompts;
    case "mcp":
      return t.customizeMcp;
    default:
      return t.customizePlugins;
  }
});

const createKind = computed<CustomizationCreateKind | null>(() => {
  switch (props.kind) {
    case "agents":
    case "skills":
    case "instructions":
    case "prompts":
      return props.kind;
    default:
      return null;
  }
});

const createLabel = computed(() => {
  switch (props.kind) {
    case "agents":
      return t.customizeNewAgent;
    case "skills":
      return t.customizeNewSkill;
    case "instructions":
      return t.customizeNewInstructions;
    default:
      return t.customizeNewPrompt;
  }
});

function toggleGroup(scope: CustomizationScope): void {
  if (collapsed.has(scope)) collapsed.delete(scope);
  else collapsed.add(scope);
}

/** 新建或配置文件的名字：技能取父目录名，其余取去掉扩展名的文件名。 */
function titleFromPath(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  const file = (parts.pop() ?? filePath).replace(/\.disabled$/i, "");
  const stem = file.replace(/\.[^.]+$/, "");
  return stem.toLowerCase() === "skill" ? (parts.pop() ?? stem) : stem;
}

function openItem(item: CustomizationItem): void {
  if (props.kind === "plugins") {
    if (!item.filePath) {
      message.error(t.customizePluginPathMissing);
      return;
    }
    void window.api.workspace.revealInFolder(item.filePath).catch((err) => {
      message.error(err instanceof Error ? err.message : String(err));
    });
    return;
  }
  if (!item.filePath) return;
  emit("open", { filePath: item.filePath, title: item.name });
}

async function copyPath(item: CustomizationItem): Promise<void> {
  if (!item.filePath) return;
  try {
    await navigator.clipboard.writeText(item.filePath);
    message.success(t.customizePathCopied);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

async function onCreate(): Promise<void> {
  const kind = createKind.value;
  if (!kind) return;
  try {
    const { filePath } = await window.api.customizations.create(kind);
    emit("refresh");
    emit("open", { filePath, title: titleFromPath(filePath) });
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function onAddClick(): void {
  if (props.kind === "skills") {
    skillAddOpen.value = true;
    return;
  }
  void onCreate();
}

function onSkillAdded(payload: { filePath: string; name: string }): void {
  emit("refresh");
  emit("open", { filePath: payload.filePath, title: payload.name });
}

function pluginScope(item: CustomizationItem): "global" | "project" {
  return item.scope === "project" ? "project" : "global";
}

async function setEnabled(item: CustomizationItem, enabled: boolean): Promise<void> {
  try {
    if (props.kind === "skills" && item.filePath) {
      // 先本地生效，写入失败再回滚，避免列表整表刷新。
      store.setSkillEnabled(item.id, enabled);
      try {
        await window.api.skills.setDisabled(
          item.filePath,
          !enabled,
          workspace.root ?? undefined,
        );
      } catch (err) {
        store.setSkillEnabled(item.id, !enabled);
        throw err;
      }
      return;
    } else if ((props.kind === "agents" || props.kind === "prompts") && item.filePath) {
      const { filePath } = await window.api.customizations.setItemEnabled(
        item.filePath,
        enabled,
        workspace.root ?? undefined,
      );
      store.setFileItemEnabled(props.kind, item.id, enabled, filePath);
      return;
    } else if (props.kind === "plugins" && item.source) {
      // 先本地生效，写入失败再回滚，避免列表整表刷新。
      store.setPluginEnabled(item.id, enabled);
      try {
        await window.api.plugins.setEnabled(
          item.source,
          pluginScope(item),
          enabled,
          workspace.root ?? undefined,
        );
      } catch (err) {
        store.setPluginEnabled(item.id, !enabled);
        throw err;
      }
      return;
    } else if (props.kind === "mcp") {
      // 先本地生效，写入失败再回滚，避免列表整表刷新。
      store.setMcpEnabled(item.id, enabled);
      try {
        await window.api.customizations.setMcpEnabled(
          item.name,
          item.scope === "project" ? "project" : "user",
          enabled,
          workspace.root ?? undefined,
        );
      } catch (err) {
        store.setMcpEnabled(item.id, !enabled);
        throw err;
      }
      return;
    }
    emit("refresh");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

/** 用户级与工作区级的智能体/提示文件可启停、可删除。 */
function isEditableItem(item: CustomizationItem): boolean {
  return (item.scope === "user" || item.scope === "project") && Boolean(item.filePath);
}

function canToggle(item: CustomizationItem): boolean {
  if (props.kind === "skills") return Boolean(item.filePath) && item.enabled !== undefined;
  if (props.kind === "mcp") return item.enabled !== undefined;
  if (props.kind === "agents" || props.kind === "prompts") return isEditableItem(item);
  return props.kind === "plugins" && Boolean(item.source);
}

/** 检查插件版本，结果缓存到 store，切换设置页后仍显示版本徽标与升级按钮。 */
async function checkPluginUpdateState(): Promise<void> {
  try {
    const list = await pluginUpdates.check(workspace.root ?? undefined);
    if (!list) return;
    const count = list.filter((info) => info.hasUpdate).length;
    if (count > 0) message.success(t.customizeUpdatesFound(count));
    else message.success(t.customizeNoUpdates);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function versionInfoOf(item: CustomizationItem): PluginVersionInfo | undefined {
  return item.source ? pluginUpdates.versions[item.id] : undefined;
}

/** 行内版本文案：有更新时显示「本地 → 最新」，否则只显示本地版本。 */
function versionLabel(item: CustomizationItem): string {
  const info = versionInfoOf(item);
  if (!info?.currentVersion) return "";
  if (info.hasUpdate && info.latestVersion) {
    return `${info.currentVersion} → ${info.latestVersion}`;
  }
  return info.currentVersion;
}

function progressOf(item: CustomizationItem): PluginUpdateProgress | undefined {
  return item.source ? pluginUpdates.progress[item.id] : undefined;
}

/** 进度文案：git 显示真实百分比，npm 显示正在获取的包名。 */
function progressLabel(progress: PluginUpdateProgress): string {
  if (progress.phase === "fetch") {
    if (progress.percent !== undefined) return t.pluginUpdateDownloading(progress.percent);
    if (progress.packageName) return t.pluginUpdateFetching(progress.packageName);
  }
  return t.pluginUpdatePreparing;
}

function progressLabelOf(item: CustomizationItem): string {
  const progress = progressOf(item);
  return progress ? progressLabel(progress) : "";
}

function isUpgrading(id: string): boolean {
  return pluginUpdates.upgrading.has(id);
}

/** 升级单个插件：就地更新该行版本，不整页刷新，也不影响其他行的按钮。 */
async function upgradePlugin(item: CustomizationItem): Promise<void> {
  if (!item.source) return;
  try {
    const done = await pluginUpdates.upgrade(
      item.id,
      item.source,
      pluginScope(item),
      workspace.root ?? undefined,
    );
    if (done) message.success(t.customizeUpdated(item.name));
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

/** 可选工作区：最近工作区 + 当前工作区（去重）。 */
const scopedWorkspaces = computed(() => {
  const paths = [...workspace.recent];
  const root = workspace.root?.trim();
  if (root && !paths.some((p) => p.toLowerCase() === root.toLowerCase())) {
    paths.push(root);
  }
  return paths;
});

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

/** 工作区重名时显示完整路径以便区分。 */
function workspaceLabel(target: string): string {
  const base = baseName(target);
  const duplicated = scopedWorkspaces.value.filter((p) => baseName(p) === base).length > 1;
  return duplicated ? target : base;
}

const editConfigOptions = computed<DropdownOption[]>(() => [
  { label: t.customizeGroupUser, key: "user" },
  ...scopedWorkspaces.value.map((target) => ({ label: workspaceLabel(target), key: `project:${target}` })),
]);

/** 打开 MCP 配置文件供手动编辑，不存在时由主进程写入空骨架。 */
async function onEditConfigSelect(key: string | number): Promise<void> {
  const raw = String(key);
  const isProject = raw.startsWith("project:");
  const target = isProject ? raw.slice("project:".length) : "";
  if (isProject && !target) {
    message.error(t.slashNeedWorkspace);
    return;
  }
  try {
    const { filePath } = await window.api.customizations.ensureMcpConfig(
      isProject ? "project" : "user",
      isProject ? target : undefined,
    );
    emit("open", { filePath, title: titleFromPath(filePath) });
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function onMcpAdded(): void {
  emit("refresh");
}

const enabledMcpItems = computed(() => props.items.filter((item) => item.enabled !== false));

/** 从 `<workspace>/.pi/mcp.json` 反推出工作区路径。 */
function workspaceOf(item: CustomizationItem): string | undefined {
  if (item.scope !== "project" || !item.filePath) return undefined;
  return item.filePath.replace(/[\\/]\.pi[\\/][^\\/]+$/, "");
}

/** 逐一测试已启用的 MCP 服务器可用性（initialize 握手 + tools/list）。 */
async function testMcpServers(): Promise<void> {
  const items = enabledMcpItems.value;
  if (items.length === 0 || mcpTesting.value) return;
  mcpTesting.value = true;
  mcpTestResults.value = {};
  try {
    const results = await window.api.customizations.testMcpServers(
      items.map((item) => ({
        name: item.name,
        scope: item.scope === "project" ? ("project" as const) : ("user" as const),
        workspace: workspaceOf(item),
      })),
    );
    const next: Record<string, McpTestResult> = {};
    for (const result of results) {
      const item = items.find(
        (entry) =>
          entry.name === result.name &&
          (entry.scope === "project" ? "project" : "user") === result.scope,
      );
      if (item) next[item.id] = result;
    }
    mcpTestResults.value = next;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    mcpTesting.value = false;
  }
}

function testBadge(item: CustomizationItem): { text: string; className: string } | null {
  if (item.enabled === false) return null;
  if (mcpTesting.value) return { text: t.customizeMcpTesting, className: "is-pending" };
  const result = mcpTestResults.value[item.id];
  if (!result) return null;
  if (result.ok) {
    return {
      text: t.customizeMcpTestOk(result.toolCount, (result.durationMs / 1000).toFixed(1)),
      className: "is-ok",
    };
  }
  const error = result.error === "timeout" ? t.customizeMcpTestTimeout : (result.error ?? "");
  return { text: t.customizeMcpTestFailed(error), className: "is-fail" };
}

/** 技能规范校验问题标签（仅技能列表显示）。 */
function skillWarning(item: CustomizationItem): { text: string; hint: string } | null {
  if (props.kind !== "skills" || !item.warning) return null;
  switch (item.warning) {
    case "missing-description":
      return {
        text: t.customizeSkillIssueMissingDescription,
        hint: t.customizeSkillIssueMissingDescriptionHint,
      };
    case "description-too-long":
      return {
        text: t.customizeSkillIssueLongDescription,
        hint: t.customizeSkillIssueLongDescriptionHint,
      };
    default:
      return {
        text: t.customizeSkillIssueInvalidName,
        hint: t.customizeSkillIssueInvalidNameHint,
      };
  }
}

function canRemove(item: CustomizationItem): boolean {
  if (props.kind === "skills") return Boolean(item.filePath);
  if (props.kind === "mcp") return true;
  if (props.kind === "agents" || props.kind === "prompts") return isEditableItem(item);
  return props.kind === "plugins" && Boolean(item.source);
}

function removeLabel(): string {
  if (props.kind === "mcp") return t.customizeMcpRemove;
  if (props.kind === "agents" || props.kind === "prompts") return t.customizeDelete;
  return props.kind === "plugins" ? t.customizeUninstallPlugin : t.customizeUninstall;
}

function confirmRemove(item: CustomizationItem): void {
  dialog.warning({
    title: removeLabel(),
    content:
      props.kind === "mcp"
        ? t.customizeMcpRemoveConfirm(item.name)
        : props.kind === "agents" || props.kind === "prompts"
          ? t.customizeDeleteConfirm(item.name)
          : t.customizeUninstallConfirm(item.name),
    positiveText: removeLabel(),
    negativeText: t.cancel,
    onPositiveClick: async () => {
      try {
        if (props.kind === "skills" && item.filePath) {
          await window.api.skills.uninstall(item.filePath, workspace.root ?? undefined);
          store.removeFileItem(props.kind, item.id);
          return;
        } else if ((props.kind === "agents" || props.kind === "prompts") && item.filePath) {
          await window.api.customizations.removeItem(
            item.filePath,
            workspace.root ?? undefined,
          );
          store.removeFileItem(props.kind, item.id);
          return;
        } else if (props.kind === "plugins" && item.source) {
          await window.api.plugins.remove(
            item.source,
            pluginScope(item),
            workspace.root ?? undefined,
          );
        } else if (props.kind === "mcp") {
          await window.api.customizations.removeMcpServer(
            item.name,
            item.scope === "project" ? "project" : "user",
            workspace.root ?? undefined,
          );
          store.removeMcp(item.id);
          return;
        }
        emit("refresh");
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      }
    },
  });
}

function openContextMenu(event: MouseEvent, item: CustomizationItem): void {
  event.preventDefault();
  ctx.item = item;
  ctx.x = event.clientX;
  ctx.y = event.clientY;
  ctx.show = true;
}

const ctxOptions = computed<DropdownOption[]>(() => {
  const item = ctx.item;
  if (!item) return [];
  const options: DropdownOption[] = [{ label: t.customizeOpen, key: "open", disabled: !item.filePath }];
  if (props.kind !== "plugins") {
    options.push({ label: t.customizeCopyPath, key: "copy", disabled: !item.filePath });
  }
  if (canToggle(item)) {
    options.push({
      label: item.enabled === false ? t.customizeEnable : t.customizeDisable,
      key: "toggle",
    });
  }
  if (canRemove(item)) {
    options.push({ label: removeLabel(), key: "remove" });
  }
  return options;
});

function onCtxSelect(key: string | number): void {
  const item = ctx.item;
  ctx.show = false;
  if (!item) return;
  switch (String(key)) {
    case "open":
      openItem(item);
      break;
    case "copy":
      void copyPath(item);
      break;
    case "toggle":
      void setEnabled(item, item.enabled === false);
      break;
    case "remove":
      confirmRemove(item);
      break;
  }
}
</script>

<template>
  <div class="customize-list">
    <div class="list-search-and-button-container">
      <div class="list-search-container">
        <NInput
          v-model:value="query"
          size="small"
          clearable
          :placeholder="t.customizeSearchPlaceholder"
        />
      </div>
      <div class="list-add-button-container">
        <NButton v-if="createKind" class="list-add-button" size="small" @click="onAddClick">
          {{ createLabel }}
        </NButton>
        <NButton v-if="kind === 'plugins'" class="list-add-button" size="small" @click="emit('market')">
          {{ t.customizeBrowseMarket }}
        </NButton>
        <NButton
          v-if="kind === 'plugins'"
          class="list-add-button"
          size="small"
          :loading="pluginUpdates.checking"
          @click="checkPluginUpdateState"
        >
          {{ t.customizeCheckUpdates }}
        </NButton>
        <NButton v-if="kind === 'mcp'" class="list-add-button" size="small" @click="addOpen = true">
          {{ t.customizeMcpAdd }}
        </NButton>
        <NDropdown
          v-if="kind === 'mcp'"
          trigger="click"
          :options="editConfigOptions"
          @select="onEditConfigSelect"
        >
          <NButton class="list-add-button" size="small">{{ t.customizeMcpEditConfig }}</NButton>
        </NDropdown>
        <NButton
          v-if="kind === 'mcp'"
          class="list-add-button"
          size="small"
          :loading="mcpTesting"
          :disabled="enabledMcpItems.length === 0"
          @click="testMcpServers"
        >
          {{ t.customizeMcpTest }}
        </NButton>
      </div>
    </div>

    <div v-if="!grouped.length" class="list-empty-state">
      <div class="empty-state-header">
        <span class="empty-state-text">{{ t.customizeEmpty(emptyLabel) }}</span>
      </div>
      <div class="empty-state-subtext">{{ t.customizeEmptyHint }}</div>
    </div>

    <div v-else class="list-container">
      <div v-for="group in grouped" :key="group.scope" class="group-block">
        <button
          type="button"
          class="ai-customization-group-header"
          :class="{ collapsed: collapsed.has(group.scope) }"
          @click="toggleGroup(group.scope)"
        >
          <span class="group-label-group">
            <span class="group-label">{{ group.label }}</span>
          </span>
          <span class="group-count">{{ group.items.length }}</span>
          <span class="group-info" :title="group.hint">
            <CodiconIcon name="about" :size="14" />
          </span>
          <span class="group-chevron">
            <CodiconIcon
              :name="collapsed.has(group.scope) ? 'chevronRight' : 'chevronDown'"
              :size="14"
            />
          </span>
        </button>

        <template v-if="!collapsed.has(group.scope)">
          <div
            v-for="item in group.items"
            :key="item.id"
            class="ai-customization-list-item"
            @click="openItem(item)"
            @contextmenu="openContextMenu($event, item)"
          >
            <div class="item-left">
              <div class="item-text">
                <div class="item-name-row">
                  <span class="item-name">{{ item.name }}</span>
                  <span v-if="progressOf(item)" class="inline-badge progress-badge">
                    {{ progressLabelOf(item) }}
                  </span>
                  <span v-else-if="versionLabel(item)" class="inline-badge version-badge">
                    {{ versionLabel(item) }}
                  </span>
                  <span v-if="item.enabled === false" class="inline-badge item-badge">
                    {{ t.customizeDisabled }}
                  </span>
                  <span
                    v-if="testBadge(item)"
                    class="inline-badge test-badge"
                    :class="testBadge(item)?.className"
                  >
                    {{ testBadge(item)?.text }}
                  </span>
                  <span
                    v-if="skillWarning(item)"
                    class="inline-badge warning-badge"
                    :title="skillWarning(item)?.hint"
                  >
                    {{ skillWarning(item)?.text }}
                  </span>
                </div>
                <div v-if="item.description" class="item-description">{{ item.description }}</div>
              </div>
            </div>
            <div
              class="item-right"
              :class="{ 'item-right-pinned': canToggle(item) }"
            >
              <NButton
                v-if="versionInfoOf(item)?.hasUpdate"
                class="item-update-button"
                size="tiny"
                type="primary"
                secondary
                :loading="isUpgrading(item.id)"
                @click.stop="upgradePlugin(item)"
              >
                {{ t.customizeUpdate }}
              </NButton>
              <NSwitch
                v-if="canToggle(item)"
                class="item-switch"
                size="small"
                :value="item.enabled !== false"
                :title="item.enabled === false ? t.customizeEnable : t.customizeDisable"
                @click.stop
                @update:value="(value: boolean) => setEnabled(item, value)"
              />
              <button
                v-if="canRemove(item)"
                type="button"
                class="item-action"
                :title="removeLabel()"
                @click.stop="confirmRemove(item)"
              >
                <CodiconIcon name="remove" :size="15" />
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <NDropdown
      placement="bottom-start"
      trigger="manual"
      :x="ctx.x"
      :y="ctx.y"
      :show="ctx.show"
      :options="ctxOptions"
      @clickoutside="ctx.show = false"
      @select="onCtxSelect"
    />

    <McpAddModal
      :show="addOpen"
      :workspaces="scopedWorkspaces"
      @close="addOpen = false"
      @added="onMcpAdded"
    />

    <SkillAddModal
      :show="skillAddOpen"
      :workspaces="scopedWorkspaces"
      @close="skillAddOpen = false"
      @added="onSkillAdded"
    />
  </div>
</template>

<style scoped>
.customize-list {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.list-search-and-button-container {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
  gap: 8px;
  padding-top: 16px;
  margin-bottom: 16px;
}

.list-search-container {
  flex: 1;
  min-width: 0;
}

.list-add-button-container {
  flex-shrink: 0;
}

.list-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.group-block {
  display: flex;
  flex-direction: column;
}

.ai-customization-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
  margin: 0;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.ai-customization-group-header:hover {
  background-color: var(--bg-hover);
}

.group-label-group {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}

.group-label {
  color: var(--fg);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
  text-align: right;
}

.group-info {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--fg-muted);
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ai-customization-group-header:hover .group-info {
  opacity: 0.7;
}

.group-info:hover {
  opacity: 1;
}

.group-chevron {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: auto;
  opacity: 0.7;
}

.ai-customization-list-item {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 12px 6px 16px;
  border-radius: 4px;
  cursor: pointer;
}

.ai-customization-list-item:hover {
  background-color: var(--bg-hover);
}

.item-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 10px;
  overflow: hidden;
}

.item-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.item-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.item-name {
  color: var(--fg);
  font-size: 13px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-badge.is-ok {
  color: var(--success);
}

.test-badge.is-fail {
  color: var(--error);
}

.warning-badge {
  color: var(--warning);
}

.inline-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--bg-active);
  color: var(--fg-muted);
  font-size: 10px;
  line-height: 16px;
}

.item-description {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  margin-left: 16px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

/* 带启停开关的行常显操作区，便于直接切换启停状态。 */
.item-right-pinned {
  opacity: 1;
}

.item-switch {
  flex-shrink: 0;
}

.item-update-button {
  flex-shrink: 0;
}

.version-badge {
  font-family: var(--font-mono, ui-monospace, monospace);
}

.progress-badge {
  color: var(--accent);
}

.ai-customization-list-item:hover .item-right,
.ai-customization-list-item:focus-within .item-right {
  opacity: 1;
}

.item-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.item-action:hover {
  background: var(--bg-active);
  color: var(--fg);
}

.list-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 48px 24px;
  gap: 8px;
  text-align: center;
}

.empty-state-text {
  color: var(--fg);
  font-size: 16px;
  font-weight: 600;
}

.empty-state-subtext {
  max-width: 250px;
  color: var(--fg-muted);
  font-size: 13px;
  line-height: 1.4;
}
</style>
