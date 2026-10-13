<script setup lang="ts">
import { computed } from "vue";
import { NRadioButton, NRadioGroup, NText } from "naive-ui";
import { useNotifyStore } from "@renderer/stores/notify";
import { t } from "@renderer/i18n";

const notify = useNotifyStore();

const soundOn = computed({
  get: () => notify.soundEnabled,
  set: (v: boolean) => notify.setSoundEnabled(v),
});

const notifyOn = computed({
  get: () => notify.notifyEnabled,
  set: (v: boolean) => notify.setNotifyEnabled(v),
});
</script>

<template>
  <section class="settings-group">
    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.notifySound }}</NText>
        <NText depth="3" class="row-hint">{{ t.notifySoundHint }}</NText>
      </div>
      <NRadioGroup v-model:value="soundOn" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>

    <div class="switch-row">
      <div class="switch-labels">
        <NText strong>{{ t.notifySystem }}</NText>
        <NText depth="3" class="row-hint">{{ t.notifySystemHint }}</NText>
      </div>
      <NRadioGroup v-model:value="notifyOn" size="small" class="setting-radio-group">
        <NRadioButton :value="true">{{ t.switchOn }}</NRadioButton>
        <NRadioButton :value="false">{{ t.switchOff }}</NRadioButton>
      </NRadioGroup>
    </div>
  </section>
</template>

<style scoped>
.settings-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row-hint {
  font-size: 12px;
  line-height: 16px;
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

.setting-radio-group {
  flex-shrink: 0;
  width: 120px;
  display: inline-flex;
}

.setting-radio-group :deep(.n-radio-button) {
  flex: 1;
  padding: 0;
  text-align: center;
}
</style>
