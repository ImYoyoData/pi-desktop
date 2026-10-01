<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useMessage } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import ToggleButton from "@renderer/components/ToggleButton.vue";
import type {
  BuiltinExtensionItem,
  CustomizationItem,
  CustomizationScope,
} from "../../../../shared/customizations";
import { useCustomizationsStore } from "@renderer/stores/customizations";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

const props = defineProps<{
  tools: CustomizationItem[];
  builtinExtensions: BuiltinExtensionItem[];
}>();

const store = useCustomizationsStore();
const workspace = useWorkspaceStore();
const message = useMessage();

const builtinCollapsed = ref(false);

function builtinDescription(name: string): string {
  return t.customizeBuiltinExtensionDescription(name);
}

/** 开关内置扩展：主进程写全局 settings，返回最新列表后本地覆盖。 */
async function toggleBuiltin(item: BuiltinExtensionItem, enabled: boolean): Promise<void> {
  try {
    const items = await window.api.customizations.setBuiltinExtensionEnabled(
      item.name,
      enabled,
      workspace.root ?? undefined,
    );
    store.setBuiltinExtensionEnabled(items);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  }
}

type ToolGroup = {
  key: string;
  label: string;
  hint: string;
  items: CustomizationItem[];
};

function localizeDescription(tool: CustomizationItem): CustomizationItem {
  if (tool.scope !== "builtin" && tool.scope !== "desktop") return tool;
  const description = t.customizeToolDescription(tool.name) || tool.description;
  return { ...tool, description };
}

const collapsed = reactive(new Set<string>());

function toggleGroup(key: string): void {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
}

function scopeGroup(
  scope: CustomizationScope,
  label: string,
  hint: string,
  items: CustomizationItem[],
): ToolGroup {
  return { key: scope, label, hint, items: items.filter((tool) => tool.scope === scope) };
}

function pluginLabel(source: string): string {
  return source.startsWith("npm:") ? source.slice(4) : source;
}

function pluginGroups(items: CustomizationItem[]): ToolGroup[] {
  const order: string[] = [];
  const byPlugin = new Map<string, CustomizationItem[]>();
  for (const tool of items) {
    if (tool.scope !== "extension") continue;
    const source = tool.source ?? t.customizeGroupExtension;
    const list = byPlugin.get(source);
    if (list) list.push(tool);
    else {
      byPlugin.set(source, [tool]);
      order.push(source);
    }
  }
  return order.map((source) => ({
    key: `extension:${source}`,
    label: pluginLabel(source),
    hint: t.customizeGroupExtensionHint,
    items: byPlugin.get(source) ?? [],
  }));
}

const groups = computed<ToolGroup[]>(() => {
  const items = props.tools.map(localizeDescription);
  return [
    scopeGroup("builtin", t.customizeGroupBuiltin, t.customizeGroupBuiltinHint, items),
    scopeGroup("desktop", t.customizeGroupDesktop, t.customizeGroupDesktopHint, items),
    ...pluginGroups(items),
  ].filter((group) => group.items.length > 0);
});
</script>

<template>
  <div class="customize-tools">
    <div v-if="!tools.length && !builtinExtensions.length" class="list-empty-state">
      <div class="empty-state-header">
        <span class="empty-state-text">{{ t.customizeEmpty(t.customizeTools) }}</span>
      </div>
      <div class="empty-state-subtext">{{ t.customizeEmptyHint }}</div>
    </div>

    <div v-else class="list-container">
      <div v-if="builtinExtensions.length" class="group-block">
        <button
          type="button"
          class="ai-customization-group-header"
          :class="{ collapsed: builtinCollapsed }"
          @click="builtinCollapsed = !builtinCollapsed"
        >
          <span class="group-label-group">
            <span class="group-label">{{ t.customizeBuiltinExtensions }}</span>
          </span>
          <span class="group-count">
            {{ builtinExtensions.filter((item) => item.enabled).length }}/{{ builtinExtensions.length }}
          </span>
          <span class="group-info" :title="t.customizeBuiltinExtensionsHint">
            <CodiconIcon name="about" :size="14" />
          </span>
          <span class="group-chevron">
            <CodiconIcon
              :name="builtinCollapsed ? 'chevronRight' : 'chevronDown'"
              :size="14"
            />
          </span>
        </button>
        <template v-if="!builtinCollapsed">
          <div
            v-for="item in builtinExtensions"
            :key="item.id"
            class="ai-customization-list-item"
          >
            <div class="item-left">
              <div class="item-text">
                <div class="item-name-row">
                  <span class="item-name">{{ item.name }}</span>
                  <span v-if="item.overridden" class="inline-badge">
                    {{ t.customizeBuiltinOverridden }}
                  </span>
                </div>
                <div class="item-description">{{ builtinDescription(item.name) }}</div>
              </div>
            </div>
            <div class="item-right">
              <ToggleButton
                class="item-switch"
                :value="item.enabled"
                :disabled="item.overridden"
                :title="
                  item.overridden
                    ? t.customizeBuiltinOverriddenHint
                    : item.enabled
                      ? t.customizeDisable
                      : t.customizeEnable
                "
                @update:value="(value: boolean) => toggleBuiltin(item, value)"
              />
            </div>
          </div>
        </template>
      </div>

      <div v-for="group in groups" :key="group.key" class="group-block">
        <button
          type="button"
          class="ai-customization-group-header"
          :class="{ collapsed: collapsed.has(group.key) }"
          @click="toggleGroup(group.key)"
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
              :name="collapsed.has(group.key) ? 'chevronRight' : 'chevronDown'"
              :size="14"
            />
          </span>
        </button>
        <template v-if="!collapsed.has(group.key)">
          <div v-for="tool in group.items" :key="tool.id" class="ai-customization-list-item">
            <div class="item-left">
              <div class="item-text">
                <div class="item-name-row">
                  <span class="item-name">{{ tool.name }}</span>
                </div>
                <div v-if="tool.description" class="item-description">{{ tool.description }}</div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.customize-tools {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
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

.item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  margin-left: 16px;
}

.item-switch {
  flex-shrink: 0;
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
  opacity: 0.8;
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
}

.ai-customization-list-item:hover {
  background-color: var(--bg-hover);
}

.item-left {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.item-text {
  display: flex;
  flex-direction: column;
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
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-description {
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
