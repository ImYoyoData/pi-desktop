<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { NButton, NDropdown, NInput, useDialog, useMessage } from "naive-ui";
import type { DropdownOption } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import type {
  CustomizationCreateKind,
  CustomizationItem,
  CustomizationScope,
} from "../../../../shared/customizations";
import { t } from "@renderer/i18n";

type SectionKind = "agents" | "skills" | "instructions" | "prompts" | "mcp" | "plugins";

const props = defineProps<{
  kind: SectionKind;
  items: CustomizationItem[];
}>();

const emit = defineEmits<{
  refresh: [];
  market: [];
  open: [payload: { filePath: string; name: string }];
}>();

const workspace = useWorkspaceStore();
const dialog = useDialog();
const message = useMessage();

const query = ref("");
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

function openItem(item: CustomizationItem): void {
  if (!item.filePath) return;
  emit("open", { filePath: item.filePath, name: item.name });
}

async function copyPath(item: CustomizationItem): Promise<void> {
  if (!item.filePath) return;
  await navigator.clipboard.writeText(item.filePath);
  message.success(t.customizePathCopied);
}

async function onCreate(): Promise<void> {
  const kind = createKind.value;
  if (!kind) return;
  try {
    const { filePath } = await window.api.customizations.create(kind);
    emit("refresh");
    emit("open", { filePath, name: filePath.split(/[/\\]/).pop() ?? filePath });
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function pluginScope(item: CustomizationItem): "global" | "project" {
  return item.scope === "project" ? "project" : "global";
}

async function setEnabled(item: CustomizationItem, enabled: boolean): Promise<void> {
  try {
    if (props.kind === "skills" && item.filePath) {
      await window.api.skills.setDisabled(item.filePath, !enabled);
    } else if (props.kind === "plugins" && item.source) {
      await window.api.plugins.setEnabled(
        item.source,
        pluginScope(item),
        enabled,
        workspace.root ?? undefined,
      );
    }
    emit("refresh");
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

function canToggle(item: CustomizationItem): boolean {
  if (props.kind === "skills") return Boolean(item.filePath) && item.enabled !== undefined;
  return props.kind === "plugins" && Boolean(item.source);
}

function canRemove(item: CustomizationItem): boolean {
  if (props.kind === "skills") return Boolean(item.filePath);
  return props.kind === "plugins" && Boolean(item.source);
}

function confirmRemove(item: CustomizationItem): void {
  dialog.warning({
    title: props.kind === "plugins" ? t.customizeUninstallPlugin : t.customizeUninstall,
    content: t.customizeUninstallConfirm(item.name),
    positiveText: t.customizeUninstall,
    negativeText: t.cancel,
    onPositiveClick: async () => {
      try {
        if (props.kind === "skills" && item.filePath) {
          await window.api.skills.uninstall(item.filePath, workspace.root ?? undefined);
        } else if (props.kind === "plugins" && item.source) {
          await window.api.plugins.remove(
            item.source,
            pluginScope(item),
            workspace.root ?? undefined,
          );
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
  const options: DropdownOption[] = [
    { label: t.customizeOpen, key: "open", disabled: !item.filePath },
    { label: t.customizeCopyPath, key: "copy", disabled: !item.filePath },
  ];
  if (canToggle(item)) {
    options.push({
      label: item.enabled === false ? t.customizeEnable : t.customizeDisable,
      key: "toggle",
    });
  }
  if (canRemove(item)) {
    options.push({
      label: props.kind === "plugins" ? t.customizeUninstallPlugin : t.customizeUninstall,
      key: "remove",
    });
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
        <NButton v-if="createKind" class="list-add-button" size="small" @click="onCreate">
          {{ createLabel }}
        </NButton>
        <NButton v-if="kind === 'plugins'" class="list-add-button" size="small" @click="emit('market')">
          {{ t.customizeBrowseMarket }}
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
                  <span v-if="item.enabled === false" class="inline-badge item-badge">
                    {{ t.customizeDisabled }}
                  </span>
                </div>
                <div v-if="item.description" class="item-description">{{ item.description }}</div>
              </div>
            </div>
            <div class="item-right">
              <button
                v-if="item.filePath"
                type="button"
                class="item-action"
                :title="t.customizeCopyPath"
                @click.stop="copyPath(item)"
              >
                <CodiconIcon name="copy" :size="15" />
              </button>
              <button
                v-if="canRemove(item)"
                type="button"
                class="item-action"
                :title="kind === 'plugins' ? t.customizeUninstallPlugin : t.customizeUninstall"
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
