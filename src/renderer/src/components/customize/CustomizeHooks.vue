<script setup lang="ts">
import type { CustomizationHook } from "../../../../shared/customizations";
import { t } from "@renderer/i18n";

defineProps<{ hooks: CustomizationHook[] }>();
</script>

<template>
  <div class="customize-hooks">
    <div v-if="!hooks.length" class="list-empty-state">
      <div class="empty-state-header">
        <span class="empty-state-text">{{ t.customizeEmpty(t.customizeHooks) }}</span>
      </div>
      <div class="empty-state-subtext">{{ t.customizeEmptyHint }}</div>
    </div>

    <div v-else class="list-container">
      <div v-for="hook in hooks" :key="hook.event" class="ai-customization-list-item">
        <div class="item-left">
          <span class="item-name">{{ hook.event }}</span>
        </div>
        <div class="item-right">
          <span v-for="name in hook.subscribers" :key="name" class="inline-badge item-badge">
            {{ name }}
          </span>
        </div>
      </div>
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
}

.list-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
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

.item-name {
  color: var(--fg);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 18px;
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
