<script setup lang="ts">
import { onMounted, ref } from "vue";
import { NText } from "naive-ui";
import { t } from "@renderer/i18n";

type AppInfo = {
  version: string;
};

const appInfo = ref<AppInfo | null>(null);

async function refreshAppInfo(): Promise<void> {
  appInfo.value = await window.api.update.getAppInfo();
}

onMounted(() => {
  void refreshAppInfo();
});
</script>

<template>
  <div class="about-panel">
    <NText strong style="font-size: 16px">{{ t.appName }}</NText>
    <div v-if="appInfo" class="about-block">
      <div class="about-row">
        <span>{{ t.aboutVersion }}</span>
        <span>v{{ appInfo.version }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.about-panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding-top: 8px;
}

.about-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.about-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--fg-muted);
}

.about-row span:last-child {
  color: var(--fg-strong);
  font-variant-numeric: tabular-nums;
}
</style>
