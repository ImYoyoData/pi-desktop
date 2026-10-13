<script setup lang="ts">
import { NButton, NText, useMessage } from "naive-ui";
import NotifySettings from "@renderer/components/NotifySettings.vue";
import ProxySettings from "@renderer/components/ProxySettings.vue";
import { t } from "@renderer/i18n";

const message = useMessage();

async function onOpenDevTools(): Promise<void> {
  try {
    await window.api.window.openDevTools();
  } catch (err) {
    message.error(err instanceof Error ? err.message : t.cannotOpenDevtools);
  }
}
</script>

<template>
  <div class="customize-general">
    <NotifySettings />

    <div class="general-divider" />
    <ProxySettings />

    <div class="general-divider" />
    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.securityOpenDevTools }}</NText>
        <NText depth="3" class="row-hint">{{ t.securityOpenDevToolsHint }}</NText>
      </div>
      <NButton size="small" secondary @click="onOpenDevTools">{{ t.open }}</NButton>
    </div>
  </div>
</template>

<style scoped>
.customize-general {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 16px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px 20px;
}

.general-divider {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.switch-labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.row-hint {
  font-size: 12px;
  line-height: 16px;
}
</style>
