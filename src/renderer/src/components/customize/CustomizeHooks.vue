<script setup lang="ts">
import { computed, reactive } from "vue";
import { NText } from "naive-ui";
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import ThinkingLanguageSetting from "@renderer/components/customize/ThinkingLanguageSetting.vue";
import HookEventList from "@renderer/components/customize/HookEventList.vue";
import type { CustomizationHook } from "../../../../shared/customizations";
import { t } from "@renderer/i18n";

const props = defineProps<{ hooks: CustomizationHook[] }>();

const collapsed = reactive(new Set<string>());

function toggle(key: string): void {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
}

const hookCount = computed(() => props.hooks.length);
</script>

<template>
  <div class="customize-hooks">
    <div class="group-block">
      <button
        type="button"
        class="group-header"
        @click="toggle('desktop')"
      >
        <span class="group-label">{{ t.customizeHooksDesktop }}</span>
        <span class="group-info" :title="t.customizeHooksDesktopHint">
          <CodiconIcon name="about" :size="14" />
        </span>
        <span class="group-chevron">
          <CodiconIcon
            :name="collapsed.has('desktop') ? 'chevronRight' : 'chevronDown'"
            :size="14"
          />
        </span>
      </button>

      <div v-if="!collapsed.has('desktop')" class="group-body">
        <ThinkingLanguageSetting />

        <div class="mode-preamble-row">
          <div class="row-labels">
            <NText strong>{{ t.composerModePreamble }}</NText>
            <NText depth="3" class="row-hint">{{ t.composerModePreambleHint }}</NText>
          </div>
          <span class="mode-badges">
            <span class="inline-badge">{{ t.composerModeAgent }}</span>
            <span class="inline-badge">{{ t.composerModeAsk }}</span>
            <span class="inline-badge">{{ t.composerModePlan }}</span>
            <span class="inline-badge">{{ t.composerModeTask }}</span>
          </span>
        </div>
      </div>
    </div>

    <div class="group-block">
      <button
        type="button"
        class="group-header"
        @click="toggle('extensions')"
      >
        <span class="group-label">{{ t.customizeHooksExtensions }}</span>
        <span class="group-count">{{ hookCount }}</span>
        <span class="group-info" :title="t.customizeHooksDesc">
          <CodiconIcon name="about" :size="14" />
        </span>
        <span class="group-chevron">
          <CodiconIcon
            :name="collapsed.has('extensions') ? 'chevronRight' : 'chevronDown'"
            :size="14"
          />
        </span>
      </button>

      <HookEventList v-if="!collapsed.has('extensions')" :hooks="hooks" />
    </div>
  </div>
</template>

<style scoped>
.customize-hooks {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  gap: 20px;
  overflow-y: auto;
  padding: 12px 16px 20px;
}

.group-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 36px;
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

.group-header:hover {
  background-color: var(--bg-hover);
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
}

.group-info {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  color: var(--fg-muted);
  opacity: 0;
  transition: opacity 0.1s ease;
}

.group-header:hover .group-info {
  opacity: 0.7;
}

.group-info:hover {
  opacity: 1;
}

.group-chevron {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-left: auto;
  opacity: 0.7;
}

.group-body {
  display: flex;
  flex-direction: column;
}

.mode-preamble-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 12px 6px 16px;
}

.row-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-hint {
  font-size: 12px;
  line-height: 1.45;
}

.mode-badges {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
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
</style>