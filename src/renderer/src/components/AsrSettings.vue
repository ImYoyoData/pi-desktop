<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NModal,
  NSpace,
  NText,
  NButton,
  NDivider,
  NSwitch,
  NInput,
  useMessage,
} from "naive-ui";
import { formatAsrInstallError, useAsrStore } from "@renderer/stores/asr";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const asr = useAsrStore();
const message = useMessage();
const modelUrl = ref("");
let offProgress: (() => void) | undefined;

const asrEnabled = computed({
  get: () => asr.status.enabled,
  set: (v: boolean) => {
    void asr.setEnabled(v);
  },
});

function gpuKindLabel(): string {
  switch (asr.status.gpuKind) {
    case "cpu":
      return t.asrDeviceCpu;
    case "metal":
      return t.asrDeviceMetal;
    case "discrete":
      return t.asrDeviceDiscrete;
    case "integrated":
      return t.asrDeviceIntegrated;
    default: {
      const _exhaustive: never = asr.status.gpuKind;
      return _exhaustive;
    }
  }
}

async function withRuntimeToast(action: () => Promise<void>, okMsg: string): Promise<void> {
  // Same key replaces loading — Naive UI has no message.destroy(key)
  message.loading(t.asrPreparingRuntime(asr.status.gpuBackend.toUpperCase()), {
    duration: 0,
    key: "asr-runtime",
  });
  try {
    await action();
    message.success(okMsg, { key: "asr-runtime", duration: 2500 });
  } catch (err) {
    message.error(formatAsrInstallError(err, t.asrDownloadFailed), {
      key: "asr-runtime",
      duration: 6000,
    });
  }
}

async function onInstall(): Promise<void> {
  const ok = window.confirm(
    t.asrInstallConfirm(
      asr.status.diskMb,
      asr.status.ramMb,
      asr.status.gpuDeviceLabel,
      asr.status.gpuBackend.toUpperCase(),
      asr.status.gpuKind === "cpu",
    ),
  );
  if (!ok) return;
  await withRuntimeToast(() => asr.install(), t.asrInstallOk);
}

async function onInstallFromUrl(): Promise<void> {
  const url = modelUrl.value.trim();
  if (!url) {
    message.warning(t.asrUrlRequired);
    return;
  }
  await withRuntimeToast(() => asr.installFromUrl(url), t.asrInstallOk);
}

async function onPickLocal(): Promise<void> {
  try {
    const imported = await asr.importLocal();
    if (imported) message.success(t.asrInstallOk);
  } catch (err) {
    message.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
  }
}

async function onRedownloadRuntime(): Promise<void> {
  await withRuntimeToast(() => asr.reinstallRuntime(), t.asrRuntimeReady);
}

async function onPickRuntimeArchive(): Promise<void> {
  try {
    const imported = await asr.importRuntimeArchive();
    if (imported) message.success(t.asrRuntimeReady);
  } catch (err) {
    message.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
  }
}

async function onUninstall(): Promise<void> {
  await asr.uninstall();
}

watch(
  () => props.open,
  (open) => {
    if (open) void asr.refresh();
  },
);

onMounted(() => {
  offProgress = asr.bindProgress();
  void asr.refresh();
});

onUnmounted(() => {
  offProgress?.();
});
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal"
    style="width: min(560px, 92vw)"
    :title="t.asrTitle"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <div class="section">
      <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
        {{ t.asrHint }}
      </NText>
      <div class="asr-row">
        <span>{{ t.asrEnable }}</span>
        <NSwitch v-model:value="asrEnabled" size="small" :disabled="!asr.status.supported" />
      </div>
      <NText depth="3" style="font-size: 12px; margin-top: 8px">
        {{ asr.status.modelLabel }} ·
        {{ asr.status.installed ? t.asrInstalled : t.asrNotInstalled }} · ≈{{ asr.status.diskMb }}MB
        disk / ≈{{ asr.status.ramMb }}MB RAM
      </NText>
      <NText style="font-size: 12px; margin-top: 6px; display: block">
        {{ t.asrDevice }}: {{ asr.status.gpuDeviceLabel }} ({{ asr.status.gpuBackend.toUpperCase() }} /
        {{ gpuKindLabel() }})
      </NText>
      <NText
        :type="asr.status.gpuKind === 'cpu' ? 'warning' : 'default'"
        depth="3"
        style="font-size: 12px; margin-top: 4px; display: block"
      >
        {{ asr.status.gpuKind === "cpu" ? t.asrCpuSlowHint : t.asrGpuFastHint }}
      </NText>
    </div>

    <NDivider style="margin: 16px 0" />

    <div class="section">
      <NText strong>{{ t.asrModelSection }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 10px">
        {{ t.asrManualHint }}
      </NText>
      <NSpace :size="8">
        <NButton
          size="small"
          type="primary"
          :disabled="!asr.status.supported || asr.installing || asr.status.installed"
          :loading="asr.installing"
          @click="onInstall"
        >
          {{ t.asrInstall }}
        </NButton>
        <NButton
          size="small"
          :disabled="(!asr.status.modelPath && !asr.status.binaryPath) || asr.installing"
          @click="onUninstall"
        >
          {{ t.asrUninstall }}
        </NButton>
      </NSpace>
      <NInput
        v-model:value="modelUrl"
        size="small"
        style="margin-top: 10px"
        :disabled="!asr.status.supported || asr.installing"
        :placeholder="t.asrCustomUrlPlaceholder"
        clearable
      />
      <NSpace style="margin-top: 8px" :size="8">
        <NButton
          size="small"
          :disabled="!asr.status.supported || asr.installing"
          :loading="asr.installing"
          @click="onInstallFromUrl"
        >
          {{ t.asrDownloadFromUrl }}
        </NButton>
        <NButton
          size="small"
          :disabled="!asr.status.supported || asr.installing"
          @click="onPickLocal"
        >
          {{ t.asrPickLocal }}
        </NButton>
      </NSpace>
    </div>

    <NDivider style="margin: 16px 0" />

    <div class="section">
      <NText strong>{{ t.asrRuntimeTitle }}</NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 8px">
        {{ t.asrRuntimeHint }}
      </NText>
      <NText
        v-if="asr.status.runtimeArchiveHint"
        depth="3"
        style="font-size: 12px; display: block; margin-bottom: 10px; word-break: break-all"
      >
        {{ t.asrRuntimeArchiveHint(asr.status.runtimeArchiveHint) }}
      </NText>
      <NSpace :size="8">
        <NButton
          size="small"
          :disabled="!asr.status.supported || asr.installing"
          :loading="asr.installing"
          @click="onRedownloadRuntime"
        >
          {{ t.asrRedownloadRuntime }}
        </NButton>
        <NButton
          size="small"
          :disabled="!asr.status.supported || asr.installing"
          @click="onPickRuntimeArchive"
        >
          {{ t.asrPickRuntimeArchive }}
        </NButton>
      </NSpace>
    </div>

    <AsrInstallProgress
      v-if="asr.installing || asr.progress?.phase === 'error'"
      style="margin-top: 14px"
    />

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
.asr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.footer {
  display: flex;
  justify-content: flex-end;
}
</style>
