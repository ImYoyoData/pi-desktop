<script setup lang="ts">
import type { CustomizationHook } from "../../../../shared/customizations";
import { t } from "@renderer/i18n";

defineProps<{ hooks: CustomizationHook[] }>();
</script>

<template>
  <div class="hook-event-list">
    <div v-if="!hooks.length" class="list-empty-state">
      <div class="empty-state-text">{{ t.customizeHooksExtensionsEmpty }}</div>
      <div class="empty-state-subtext">{{ t.customizeHooksExtensionsEmptyHint }}</div>
    </div>

    <div v-else class="list-container">
      <div v-for="hook in hooks" :key="hook.event" class="hook-event-item">
        <span class="item-name">{{ hook.event }}</span>
        <span class="item-badges">
          <span v-for="name in hook.subscribers" :key="name" class="inline-badge item-badge">
            {{ name }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hook-event-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.list-container {
  display: flex;
  flex-direction: column;
}

.hook-event-item {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 12px 6px 16px;
  border-radius: 4px;
}

.hook-event-item:hover {
  background-color: var(--bg-hover);
}

.item-name {
  flex: 1;
  min-width: 0;
  color: var(--fg);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-badges {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 4px;
  margin-left: 16px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.hook-event-item:hover .item-badges,
.hook-event-item:focus-within .item-badges {
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
  padding: 24px;
  gap: 8px;
  text-align: center;
}

.empty-state-text {
  color: var(--fg);
  font-size: 14px;
  font-weight: 600;
}

.empty-state-subtext {
  max-width: 320px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.4;
}
</style>