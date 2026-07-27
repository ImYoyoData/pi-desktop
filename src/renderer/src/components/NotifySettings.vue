<script setup lang="ts">
import { computed } from "vue";
import { NModal, NSwitch, NText, NButton, NDivider, useMessage } from "naive-ui";
import { useNotifyStore } from "@renderer/stores/notify";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

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
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(520px, 92vw)"
    :title="t.notifyTitle"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <div class="section">
      <div class="row">
        <div class="labels">
          <NText strong>{{ t.notifySound }}</NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.notifySoundHint }}
          </NText>
        </div>
        <NSwitch v-model:value="soundOn" />
      </div>
      <NButton size="small" secondary style="align-self: flex-start; margin-top: 10px" @click="onPreview">
        {{ t.notifyPreview }}
      </NButton>
    </div>

    <NDivider style="margin: 18px 0" />

    <div class="section">
      <div class="row">
        <div class="labels">
          <NText strong>{{ t.notifySystem }}</NText>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.notifySystemHint }}
          </NText>
        </div>
        <NSwitch v-model:value="notifyOn" />
      </div>
    </div>

    <template #footer>
      <div class="footer">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.section {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.labels {
  flex: 1;
  min-width: 0;
}
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
