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
  NSelect,
  useMessage,
} from "naive-ui";
import type { SelectOption } from "naive-ui";
import { formatAsrInstallError, useAsrStore } from "@renderer/stores/asr";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import { formatAcceleratorLabel, keyboardEventToAccelerator } from "../../../shared/hotkey";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const asr = useAsrStore();
const message = useMessage();
const modelUrl = ref("");
const capturingHotkey = ref(false);
let offProgress: (() => void) | undefined;

const asrEnabled = computed({
  get: () => asr.status.enabled,
  set: (v: boolean) => {
    void asr.setEnabled(v);
  },
});

const residentModel = computed({
  get: () => asr.status.residentModel,
  set: (v: boolean) => {
    void asr.setResidentModel(v);
  },
});

const wakeWordsDraft = ref(asr.status.wakeWords || "");
let wakeWordsTimer: ReturnType<typeof setTimeout> | null = null;

watch(
  () => asr.status.wakeWords,
  (v) => {
    if (document.activeElement?.closest?.(".asr-wake-words")) return;
    wakeWordsDraft.value = v || "";
  },
);

function onWakeWordsInput(v: string): void {
  wakeWordsDraft.value = v;
  if (wakeWordsTimer) clearTimeout(wakeWordsTimer);
  wakeWordsTimer = setTimeout(() => {
    void asr.setWakeWords(wakeWordsDraft.value);
  }, 400);
}

const wakeHotkeyLabel = computed(() =>
  formatAcceleratorLabel(asr.status.wakeHotkey || "Control+Alt+Y"),
);

const gpuPreference = computed({
  get: () => asr.status.gpuPreference || "auto",
  set: (v: string) => {
    void onGpuPreferenceChange(v);
  },
});

const gpuSelectOptions = computed<SelectOption[]>(() =>
  (asr.status.gpuOptions ?? []).map((opt) => ({
    label: opt.id === "auto" ? t.asrGpuAuto : opt.id === "cpu" ? t.asrDeviceCpu : opt.label,
    value: opt.id,
  })),
);

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

function stopHotkeyCapture(): void {
  if (!capturingHotkey.value) return;
  capturingHotkey.value = false;
  asr.setCapturingHotkey(false);
  window.removeEventListener("keydown", onHotkeyCaptureKeydown, true);
}

function startHotkeyCapture(): void {
  if (capturingHotkey.value) {
    stopHotkeyCapture();
    return;
  }
  capturingHotkey.value = true;
  asr.setCapturingHotkey(true);
  window.addEventListener("keydown", onHotkeyCaptureKeydown, true);
}

async function onHotkeyCaptureKeydown(e: KeyboardEvent): Promise<void> {
  if (!capturingHotkey.value) return;
  if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    e.stopPropagation();
    stopHotkeyCapture();
    return;
  }
  // Ignore pure modifier presses
  const accel = keyboardEventToAccelerator(e);
  if (!accel) return;
  e.preventDefault();
  e.stopPropagation();
  stopHotkeyCapture();
  try {
    await asr.setWakeHotkey(accel);
    message.success(t.asrWakeHotkeySaved);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (/already in use/i.test(raw)) {
      message.error(t.asrWakeHotkeyInUse);
    } else if (/invalid/i.test(raw)) {
      message.error(t.asrWakeHotkeyInvalid);
    } else {
      message.error(raw || t.asrWakeHotkeyInvalid);
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

async function onGpuPreferenceChange(value: string): Promise<void> {
  try {
    const prevBackend = asr.status.gpuBackend;
    const next = await asr.setGpuPreference(value);
    if (next.gpuBackend !== prevBackend || !next.runtimeMatchesPreference) {
      message.info(t.asrGpuRuntimeMismatch, { duration: 4500 });
    }
  } catch (err) {
    message.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 5000 });
    await asr.refresh();
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
    else stopHotkeyCapture();
  },
);

onMounted(() => {
  offProgress = asr.bindProgress();
  void asr.refresh();
});

onUnmounted(() => {
  stopHotkeyCapture();
  offProgress?.();
  if (wakeWordsTimer) clearTimeout(wakeWordsTimer);
  if (wakeWordsDraft.value !== (asr.status.wakeWords || "")) {
    void asr.setWakeWords(wakeWordsDraft.value);
  }
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
      <div class="asr-row" style="margin-top: 12px; align-items: flex-start">
        <div style="flex: 1; min-width: 0">
          <div>{{ t.asrWakeHotkey }}</div>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ capturingHotkey ? t.asrWakeHotkeyListening : t.asrWakeHotkeyHint }}
          </NText>
        </div>
        <NButton
          size="small"
          :type="capturingHotkey ? 'primary' : 'default'"
          :disabled="!asr.status.supported"
          @click="startHotkeyCapture"
        >
          {{ capturingHotkey ? "…" : wakeHotkeyLabel }}
        </NButton>
      </div>
      <div class="asr-row" style="margin-top: 12px; align-items: flex-start">
        <div style="flex: 1; min-width: 0">
          <div>{{ t.asrResidentModel }}</div>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
            {{ t.asrResidentHint }}
          </NText>
        </div>
        <NSwitch
          v-model:value="residentModel"
          size="small"
          :disabled="!asr.status.supported || !asr.status.enabled"
        />
      </div>
      <div class="asr-wake-words" style="margin-top: 12px">
        <div>{{ t.asrWakeWords }}</div>
        <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 8px">
          {{ t.asrWakeWordsHint }}
        </NText>
        <NInput
          :value="wakeWordsDraft"
          type="textarea"
          size="small"
          :rows="3"
          :disabled="!asr.status.supported"
          :placeholder="t.asrWakeWordsPlaceholder"
          @update:value="onWakeWordsInput"
        />
      </div>
      <NText depth="3" style="font-size: 12px; margin-top: 8px">
        {{ asr.status.modelLabel }} ·
        {{ asr.status.installed ? t.asrInstalled : t.asrNotInstalled }} · ≈{{ asr.status.diskMb }}MB
        disk / ≈{{ asr.status.ramMb }}MB RAM
      </NText>

      <NText strong style="font-size: 12px; margin-top: 14px; display: block">
        {{ t.asrGpuSelect }}
      </NText>
      <NText depth="3" style="font-size: 12px; display: block; margin: 4px 0 8px">
        {{ t.asrGpuSelectHint }}
      </NText>
      <NSelect
        v-model:value="gpuPreference"
        size="small"
        :options="gpuSelectOptions"
        :disabled="!asr.status.supported || asr.installing"
      />
      <NText style="font-size: 12px; margin-top: 8px; display: block">
        {{ t.asrDevice }}: {{ asr.status.gpuDeviceLabel }} ({{ asr.status.gpuBackend.toUpperCase() }} /
        {{ gpuKindLabel() }})
      </NText>
      <NText
        v-if="!asr.status.runtimeMatchesPreference"
        type="warning"
        style="font-size: 12px; margin-top: 4px; display: block"
      >
        {{ t.asrGpuRuntimeMismatch }}
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
          :type="asr.status.runtimeMatchesPreference ? 'default' : 'primary'"
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
