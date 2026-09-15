<script setup lang="ts">
import CodiconIcon from "@renderer/components/icons/CodiconIcon.vue";
import { t } from "@renderer/i18n";

const emit = defineEmits<{ open: [id: string] }>();

const rows = [
  { id: "notify", icon: "notify", label: t.notifyTitle, description: t.customizeNotifyDesc },
  { id: "voice", icon: "voice", label: t.voiceTitle, description: t.customizeVoiceDesc },
  { id: "security", icon: "security", label: t.securityTitle, description: t.customizeSecurityDesc },
  { id: "proxy", icon: "proxy", label: t.proxyTitle, description: t.customizeProxyDesc },
  { id: "lan", icon: "lan", label: t.lanConsoleTitle, description: t.customizeLanDesc },
  { id: "about", icon: "about", label: t.aboutTitle, description: t.customizeAboutDesc },
] as const;
</script>

<template>
  <div class="customize-general">
    <button
      v-for="row in rows"
      :key="row.id"
      type="button"
      class="ai-customization-list-item"
      @click="emit('open', row.id)"
    >
      <div class="item-left">
        <span class="item-icon"><CodiconIcon :name="row.icon" :size="16" /></span>
        <div class="item-text">
          <div class="item-name-row">
            <span class="item-name">{{ row.label }}</span>
          </div>
          <div class="item-description">{{ row.description }}</div>
        </div>
      </div>
      <div class="item-right">
        <span class="item-chevron"><CodiconIcon name="chevronRight" :size="14" /></span>
      </div>
    </button>
  </div>
</template>

<style scoped>
.customize-general {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-top: 8px;
}

.ai-customization-list-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 32px;
  margin: 0;
  padding: 6px 12px 6px 16px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
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

.item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  opacity: 0.85;
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
  margin-left: 16px;
  opacity: 0;
  transition: opacity 0.1s ease;
}

.ai-customization-list-item:hover .item-right {
  opacity: 1;
}

.item-chevron {
  display: flex;
  align-items: center;
  color: var(--fg-muted);
}
</style>
