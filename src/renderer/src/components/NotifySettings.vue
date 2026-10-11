<script setup lang="ts">
import { computed } from "vue";
import { NButton, NText, useMessage } from "naive-ui";
import ToggleButton from "@renderer/components/ToggleButton.vue";
import { useNotifyStore } from "@renderer/stores/notify";
import { t } from "@renderer/i18n";

const notify = useNotifyStore();
const message = useMessage();

const soundOn = computed({
  get: () => notify.soundEnabled,
  set: (v: boolean) => notify.setSoundEnabled(v),
});

const notifyOn = computed({
  get: () => notify.notifyEnabled,
  set: (v: boolean) => notify.setNotifyEnabled(v),
});

async function onPreview(): Promise<void> {
  await notify.playChime();
  message.success(t.notifyPreviewPlayed);
}
</script>

<template>
  <section class="settings-group">
    <div class="group-title">{{ t.notifyTitle }}</div>

    <div class="row">
      <div class="labels">
        <NText strong>{{ t.notifySound }}</NText>
        <NText depth="3" class="hint">{{ t.notifySoundHint }}</NText>
      </div>
      <ToggleButton v-model:value="soundOn" />
    </div>

    <div class="row">
      <NButton size="small" secondary @click="onPreview">
        {{ t.notifyPreview }}
      </NButton>
    </div>

    <div class="row">
      <div class="labels">
        <NText strong>{{ t.notifySystem }}</NText>
        <NText depth="3" class="hint">{{ t.notifySystemHint }}</NText>
      </div>
      <ToggleButton v-model:value="notifyOn" />
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.labels {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hint {
  font-size: 12px;
}
</style>
