<script setup lang="ts">
import { computed, reactive } from "vue";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import type { CustomizationItem, CustomizationScope } from "../../../../shared/customizations";
import { t } from "@renderer/i18n";

const props = defineProps<{ tools: CustomizationItem[] }>();

function localizeDescription(tool: CustomizationItem): CustomizationItem {
  if (tool.scope !== "builtin" && tool.scope !== "desktop") return tool;
  const description = t.customizeToolDescription(tool.name) || tool.description;
  return { ...tool, description };
}

const GROUP_ORDER: CustomizationScope[] = ["builtin", "desktop", "extension"];

const collapsed = reactive(new Set<CustomizationScope>());

function toggleGroup(scope: CustomizationScope): void {
  if (collapsed.has(scope)) collapsed.delete(scope);
  else collapsed.add(scope);
}

function groupLabel(scope: CustomizationScope): string {
  switch (scope) {
    case "builtin":
      return t.customizeGroupBuiltin;
    case "desktop":
      return t.customizeGroupDesktop;
    default:
      return t.customizeGroupExtension;
  }
}

function groupHint(scope: CustomizationScope): string {
  switch (scope) {
    case "builtin":
      return t.customizeGroupBuiltinHint;
    case "desktop":
      return t.customizeGroupDesktopHint;
    default:
      return t.customizeGroupExtensionHint;
  }
}

const groups = computed(() =>
  GROUP_ORDER.map((scope) => ({
    scope,
    label: groupLabel(scope),
    description: groupHint(scope),
    items: props.tools.filter((tool) => tool.scope === scope).map(localizeDescription),
  })).filter((group) => group.items.length > 0),
);
</script>

<template>
  <div class="customize-tools">
    <div v-if="!tools.length" class="list-empty-state">
      <div class="empty-state-header">
        <span class="empty-state-text">{{ t.customizeEmpty(t.customizeTools) }}</span>
      </div>
      <div class="empty-state-subtext">{{ t.customizeEmptyHint }}</div>
    </div>

    <div v-else class="list-container">
      <div v-for="group in groups" :key="group.scope" class="group-block">
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
          <span class="group-info" :title="group.description">
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
          <div v-for="tool in group.items" :key="tool.id" class="ai-customization-list-item">
            <div class="item-left">
              <div class="item-text">
                <div class="item-name-row">
                  <span class="item-name">{{ tool.name }}</span>
                </div>
                <div v-if="tool.description" class="item-description">{{ tool.description }}</div>
              </div>
            </div>
            <div class="item-right">
              <span v-if="tool.source" class="inline-badge item-badge">{{ tool.source }}</span>
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

.item-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  margin-left: 16px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ai-customization-list-item:hover .item-right {
  opacity: 1;
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
