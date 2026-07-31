<script setup lang="ts">
/**
 * First-install confirm: size/device summary + download mirror picker.
 */
import { computed, ref, watch } from "vue";
import { NButton, NModal, NRadio, NRadioGroup, NSpace, NText } from "naive-ui";
import { useAsrStore } from "@renderer/stores/asr";
import type { AsrDownloadMirror } from "../../../shared/asr";
import { t } from "@renderer/i18n";

const props = defineProps<{
  show: boolean;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const asr = useAsrStore();
const mirror = ref<AsrDownloadMirror>("auto");
const saving = ref(false);
/** Prevent NModal close/`update:show` from emitting cancel after Confirm. */
const closingAsConfirm = ref(false);

watch(
  () => props.show,
  (open) => {
    if (open) {
      closingAsConfirm.value = false;
      mirror.value = asr.status.downloadMirror || "auto";
    }
  },
);

const confirmBody = computed(() =>
  t.asrInstallConfirm(
    asr.status.diskMb,
    asr.status.ramMb,
    asr.status.gpuDeviceLabel,
    asr.status.gpuBackend.toUpperCase(),
    asr.status.gpuKind === "cpu",
  ),
);

async function onConfirm(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  closingAsConfirm.value = true;
  try {
    if (mirror.value !== asr.status.downloadMirror) {
      await asr.setDownloadMirror(mirror.value);
    }
    emit("confirm");
  } catch (err) {
    closingAsConfirm.value = false;
    throw err;
  } finally {
    saving.value = false;
  }
}

function onDismiss(): void {
  if (closingAsConfirm.value) return;
  emit("cancel");
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="t.asrInstall"
    :bordered="false"
    :mask-closable="false"
    :closable="true"
    style="width: min(440px, 92vw)"
    @close="onDismiss"
    @update:show="(v: boolean) => !v && onDismiss()"
  >
    <NText style="font-size: 13px; white-space: pre-wrap; display: block">
      {{ confirmBody }}
    </NText>

    <NText strong style="font-size: 12px; display: block; margin-top: 14px">
      {{ t.asrDownloadMirror }}
    </NText>
    <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 8px">
      {{ t.asrDownloadMirrorHint }}
    </NText>
    <NRadioGroup v-model:value="mirror" name="asr-download-mirror">
      <NSpace vertical :size="6">
        <NRadio value="auto">{{ t.asrDownloadMirrorAuto }}</NRadio>
        <NRadio value="china">{{ t.asrDownloadMirrorChina }}</NRadio>
        <NRadio value="global">{{ t.asrDownloadMirrorGlobal }}</NRadio>
      </NSpace>
    </NRadioGroup>

    <template #footer>
      <NSpace justify="end">
        <NButton :disabled="saving" @click="onDismiss">{{ t.cancel }}</NButton>
        <NButton type="primary" :loading="saving" @click="onConfirm">
          {{ t.asrInstallContinue }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
