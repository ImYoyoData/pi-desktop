<script setup lang="ts">
import NotifySettings from "@renderer/components/NotifySettings.vue";
import ProxySettings from "@renderer/components/ProxySettings.vue";
import SecuritySettings from "@renderer/components/SecuritySettings.vue";
import TempCleanupSettings from "@renderer/components/customize/TempCleanupSettings.vue";
</script>

<template>
  <div class="customize-general">
    <NotifySettings />
    <SecuritySettings />
    <ProxySettings />

    <div class="general-divider" />
    <TempCleanupSettings />
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
  padding-top: 8px;
}

.general-divider {
  flex-shrink: 0;
  margin: 0 12px 0 16px;
  border-top: 1px solid var(--border);
}
</style>
