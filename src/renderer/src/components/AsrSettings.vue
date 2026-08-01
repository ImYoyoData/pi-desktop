<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NModal,
  NSpace,
  NText,
  NButton,
  NSwitch,
  NInput,
  NSelect,
  NTabs,
  NTabPane,
  NProgress,
  NIcon,
  useMessage,
} from "naive-ui";
import type { SelectOption } from "naive-ui";
import { CloudOutline, HardwareChipOutline } from "@vicons/ionicons5";
import { formatAsrInstallError, isAsrInstallCancelled, useAsrStore } from "@renderer/stores/asr";
import { useTtsStore } from "@renderer/stores/tts";
import AsrInstallProgress from "@renderer/components/AsrInstallProgress.vue";
import AsrInstallConfirmModal from "@renderer/components/AsrInstallConfirmModal.vue";
import { formatAcceleratorLabel, keyboardEventToAccelerator } from "../../../shared/hotkey";
import type { AsrDownloadMirror } from "../../../shared/asr";
import { t } from "@renderer/i18n";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const asr = useAsrStore();
const tts = useTtsStore();
const message = useMessage();
const voiceTab = ref<"asr" | "tts">("asr");
const modelUrl = ref("");
const capturingHotkey = ref(false);
let offProgress: (() => void) | undefined;
let offTtsProgress: (() => void) | undefined;

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
const wakeWordsSaving = ref(false);

const wakeWordsDirty = computed(
  () => wakeWordsDraft.value.trim() !== (asr.status.wakeWords || "").trim(),
);

watch(
  () => asr.status.wakeWords,
  (v) => {
    if (document.activeElement?.closest?.(".asr-wake-words")) return;
    if (wakeWordsDirty.value) return;
    wakeWordsDraft.value = v || "";
  },
);

function onWakeWordsInput(v: string): void {
  wakeWordsDraft.value = v;
}

async function saveWakeWords(): Promise<void> {
  if (!wakeWordsDirty.value || wakeWordsSaving.value) return;
  wakeWordsSaving.value = true;
  try {
    await asr.setWakeWords(wakeWordsDraft.value);
    message.success(t.asrWakeWordsSaved);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
  } finally {
    wakeWordsSaving.value = false;
  }
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

const downloadMirror = computed({
  get: (): AsrDownloadMirror => asr.status.downloadMirror || "auto",
  set: (v: AsrDownloadMirror) => {
    void onDownloadMirrorChange(v);
  },
});

const downloadMirrorOptions = computed<SelectOption[]>(() => [
  { label: t.asrDownloadMirrorAuto, value: "auto" },
  { label: t.asrDownloadMirrorChina, value: "china" },
  { label: t.asrDownloadMirrorGlobal, value: "global" },
]);

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
  // Progress UI is AsrInstallProgress (with cancel); skip the sticky loading toast.
  try {
    await action();
    message.success(okMsg, { duration: 2500 });
  } catch (err) {
    if (isAsrInstallCancelled(err)) {
      message.info(t.asrInstallCancelled, { duration: 2000 });
      return;
    }
    message.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
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

async function onDownloadMirrorChange(value: AsrDownloadMirror): Promise<void> {
  try {
    await asr.setDownloadMirror(value);
  } catch (err) {
    message.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 5000 });
    await asr.refresh();
  }
}

const installConfirmOpen = ref(false);

async function onInstall(): Promise<void> {
  installConfirmOpen.value = true;
}

async function onInstallConfirmed(): Promise<void> {
  installConfirmOpen.value = false;
  await withRuntimeToast(() => asr.install(), t.asrInstallOk);
}

function onInstallConfirmCancel(): void {
  installConfirmOpen.value = false;
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

const ttsEnabled = computed({
  get: () => tts.status.enabled,
  set: (v: boolean) => {
    void tts.setEnabled(v);
  },
});

const ttsProgressPct = computed(() => {
  const p = tts.progress;
  if (!p || p.totalBytes == null || p.totalBytes <= 0) return null;
  return Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100));
});

async function onTtsInstall(): Promise<void> {
  try {
    await tts.install();
    message.success(t.ttsInstallOk);
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err), { duration: 6000 });
  }
}

async function onTtsUninstall(): Promise<void> {
  await tts.uninstall();
  message.success(t.ttsUninstalled);
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void asr.refresh();
      void tts.refresh();
    } else stopHotkeyCapture();
  },
);

const cloudDraft = ref<{
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
}>({
  providerName: "",
  baseUrl: "",
  apiKey: "",
  model: "",
  language: "",
});
const cloudSaving = ref(false);
const cloudTesting = ref(false);
const cloudTestResult = ref<string | null>(null);

const asrConfigTab = ref<"local" | "cloud">(
  asr.status.backend === "cloud" ? "cloud" : "local",
);

async function onAsrConfigTabChange(v: "local" | "cloud"): Promise<void> {
  asrConfigTab.value = v;
  if (v === "local") {
    await asr.setBackend("local");
    return;
  }
  // Cloud tab: switch the active backend only when a provider is configured.
  if (asr.status.cloudConfigured) {
    await asr.setBackend("cloud");
  }
}

async function loadCloudDraft(): Promise<void> {
  try {
    const cfg = await asr.getCloudConfig();
    if (cfg.cloud) cloudDraft.value = { ...cfg.cloud } as typeof cloudDraft.value;
  } catch {
    // ignore
  }
}


async function saveCloudConfig(): Promise<void> {
  cloudSaving.value = true;
  cloudTestResult.value = null;
  try {
    await asr.setCloudConfig({
      providerName: cloudDraft.value.providerName.trim(),
      baseUrl: cloudDraft.value.baseUrl.trim(),
      apiKey: cloudDraft.value.apiKey.trim(),
      model: cloudDraft.value.model.trim(),
      language: cloudDraft.value.language.trim(),
    });
    message.success(t.asrCloudSaved);
    await asr.setBackend("cloud");
  } finally {
    cloudSaving.value = false;
  }
}

async function runCloudTest(): Promise<void> {
  cloudTesting.value = true;
  cloudTestResult.value = null;
  try {
    const result = await asr.testCloud();
    cloudTestResult.value = result.ok
      ? `${t.asrCloudTestOk}: ${result.message}`
      : `${t.asrCloudTestFailed}: ${result.message}`;
  } finally {
    cloudTesting.value = false;
  }
}

onMounted(() => {
  void loadCloudDraft();
  offProgress = asr.bindProgress();
  offTtsProgress = tts.bindProgress();
  void asr.refresh();
  void tts.refresh();
});

onUnmounted(() => {
  stopHotkeyCapture();
  offProgress?.();
  offTtsProgress?.();
});
</script>

<template>
  <NModal
    :show="props.open"
    preset="card"
    class="pi-settings-modal voice-settings-modal"
    style="width: min(640px, 94vw)"
    :title="t.voiceTitle"
    :bordered="false"
    size="huge"
    @update:show="(v) => !v && emit('close')"
  >
    <NTabs v-model:value="voiceTab" class="voice-tabs" type="line" size="small" animated>
      <NTabPane name="asr" :tab="t.asrTitle">
        <div class="voice-tab-scroll asr-scroll">
          <!-- Recognition backend -->
          <div class="card">
            <div class="card-head">
              <div class="card-title">{{ t.asrBackendSection }}</div>
              <NText depth="3" class="card-hint">{{ t.asrBackendSectionHint }}</NText>
            </div>

            <div class="backend-seg" role="tablist" :aria-label="t.asrBackendSection">
              <button
                type="button"
                class="seg-btn"
                :class="{ on: asrConfigTab === 'local' }"
                :aria-selected="asrConfigTab === 'local'"
                @click="onAsrConfigTabChange('local')"
              >
                <NIcon :component="HardwareChipOutline" :size="15" />
                <span>{{ t.asrBackendLocal }}</span>
              </button>
              <button
                type="button"
                class="seg-btn"
                :class="{ on: asrConfigTab === 'cloud' }"
                :aria-selected="asrConfigTab === 'cloud'"
                @click="onAsrConfigTabChange('cloud')"
              >
                <NIcon :component="CloudOutline" :size="15" />
                <span>{{ t.asrBackendCloud }}</span>
              </button>
            </div>

            <!-- Cloud API config -->
            <div v-if="asrConfigTab === 'cloud'" class="backend-panel cloud-panel">
              <div class="field-grid">
                <label class="field">
                  <span>{{ t.asrCloudProviderName }}</span>
                  <NInput v-model:value="cloudDraft.providerName" size="small" :placeholder="t.asrCloudProviderNamePh" clearable />
                </label>
                <label class="field">
                  <span>{{ t.asrCloudBaseUrl }}</span>
                  <NInput v-model:value="cloudDraft.baseUrl" size="small" placeholder="https://api.example.com/v1" clearable />
                </label>
                <label class="field">
                  <span>{{ t.asrCloudApiKey }}</span>
                  <NInput v-model:value="cloudDraft.apiKey" size="small" type="password" :placeholder="t.asrCloudApiKeyPh" show-password-on="click" />
                </label>
                <label class="field">
                  <span>{{ t.asrCloudModel }}</span>
                  <NInput v-model:value="cloudDraft.model" size="small" :placeholder="t.asrCloudModelPh" clearable />
                </label>
                <label class="field">
                  <span>{{ t.asrCloudLanguage }}</span>
                  <NInput v-model:value="cloudDraft.language" size="small" :placeholder="t.asrCloudLanguagePh" clearable />
                </label>
              </div>
              <div class="cloud-actions">
                <NButton size="small" type="primary" :loading="cloudSaving" @click="saveCloudConfig">
                  {{ t.asrCloudSaveAndUse }}
                </NButton>
                <NButton size="small" :loading="cloudTesting" @click="runCloudTest">
                  {{ t.asrCloudTest }}
                </NButton>
              </div>
              <NText
                v-if="cloudTestResult"
                :type="cloudTestResult.startsWith(t.asrCloudTestOk) ? 'success' : 'error'"
                depth="3"
                class="test-result"
              >
                {{ cloudTestResult }}
              </NText>
              <NText depth="3" class="note">{{ t.asrCloudCompatibleNote }}</NText>
            </div>

            <!-- Local backend config -->
            <div v-else class="backend-panel local-panel">
              <div class="status-row">
                <div class="status-text">
                  <div class="setting-name">{{ asr.status.modelLabel }}</div>
                  <NText depth="3" style="font-size: 12px; display: block; margin-top: 2px">
                    {{ asr.status.installed ? t.asrInstalled : t.asrNotInstalled }}
                    · ≈{{ asr.status.diskMb }}MB disk / ≈{{ asr.status.ramMb }}MB RAM
                  </NText>
                </div>
                <div class="status-actions">
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
                </div>
              </div>

              <div class="sub-section">
                <div class="sub-title">{{ t.asrModelSection }}</div>
                <NText depth="3" class="sub-hint">{{ t.asrManualHint }}</NText>
                <NInput
                  v-model:value="modelUrl"
                  size="small"
                  :disabled="!asr.status.supported || asr.installing"
                  :placeholder="t.asrCustomUrlPlaceholder"
                  clearable
                />
                <NSpace :size="8" style="margin-top: 8px">
                  <NButton size="small" :disabled="!asr.status.supported || asr.installing" :loading="asr.installing" @click="onInstallFromUrl">
                    {{ t.asrDownloadFromUrl }}
                  </NButton>
                  <NButton size="small" :disabled="!asr.status.supported || asr.installing" @click="onPickLocal">
                    {{ t.asrPickLocal }}
                  </NButton>
                </NSpace>
              </div>

              <div class="sub-section">
                <div class="sub-title">{{ t.asrDownloadMirror }}</div>
                <NText depth="3" class="sub-hint">{{ t.asrDownloadMirrorHint }}</NText>
                <NSelect v-model:value="downloadMirror" size="small" :options="downloadMirrorOptions" :disabled="!asr.status.supported || asr.installing" />
              </div>

              <div class="sub-section">
                <div class="sub-title">{{ t.asrGpuSelect }}</div>
                <NText depth="3" class="sub-hint">{{ t.asrGpuSelectHint }}</NText>
                <NSelect v-model:value="gpuPreference" size="small" :options="gpuSelectOptions" :disabled="!asr.status.supported || asr.installing" />
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
                <NSpace :size="8" style="margin-top: 10px">
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
                <NText
                  v-if="asr.status.runtimeArchiveHint"
                  depth="3"
                  style="font-size: 12px; display: block; margin: 6px 0 0; word-break: break-all"
                >
                  {{ t.asrRuntimeArchiveHint(asr.status.runtimeArchiveHint) }}
                </NText>
              </div>
            </div>
          </div>

          <!-- General settings -->
          <div class="card">
            <div class="card-head">
              <div class="card-title">{{ t.asrGeneralSection }}</div>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-name">{{ t.asrEnable }}</div>
              </div>
              <NSwitch v-model:value="asrEnabled" size="small" :disabled="!asr.status.supported" />
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-name">{{ t.asrWakeHotkey }}</div>
                <NText depth="3" class="setting-hint">
                  {{ capturingHotkey ? t.asrWakeHotkeyListening : t.asrWakeHotkeyHint }}
                </NText>
              </div>
              <NButton
                size="small"
                :type="capturingHotkey ? 'primary' : 'default'"
                :disabled="!asr.status.supported"
                @click="startHotkeyCapture"
              >
                {{ capturingHotkey ? "···" : wakeHotkeyLabel }}
              </NButton>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-name">{{ t.asrResidentModel }}</div>
                <NText depth="3" class="setting-hint">{{ t.asrResidentHint }}</NText>
              </div>
              <NSwitch v-model:value="residentModel" size="small" :disabled="!asr.status.supported || !asr.status.enabled" />
            </div>
            <div class="setting-block">
              <div class="setting-name">{{ t.asrWakeWords }}</div>
              <NText depth="3" class="setting-hint" style="margin: 4px 0 8px">
                {{ t.asrWakeWordsHint }}
              </NText>
              <NInput
                :value="wakeWordsDraft"
                type="textarea"
                size="small"
                :rows="3"
                :disabled="!asr.status.supported"
                :placeholder="t.asrWakeWordsPlaceholder"
                class="asr-wake-words"
                @update:value="onWakeWordsInput"
              />
              <div class="asr-wake-words-actions">
                <NButton
                  size="small"
                  type="primary"
                  class="pi-interactive"
                  :disabled="!asr.status.supported || !wakeWordsDirty"
                  :loading="wakeWordsSaving"
                  @click="saveWakeWords"
                >
                  {{ t.asrWakeWordsSave }}
                </NButton>
              </div>
            </div>
          </div>

          <AsrInstallProgress
            v-if="asr.installing || asr.progress?.phase === 'error'"
            style="margin-top: 14px"
          />
          <AsrInstallConfirmModal
            :show="installConfirmOpen"
            @confirm="onInstallConfirmed"
            @cancel="onInstallConfirmCancel"
          />
        </div>
      </NTabPane>
      <NTabPane name="tts" :tab="t.ttsTitle">
        <div class="voice-tab-scroll">
        <div class="section">
          <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 10px">
            {{ t.ttsHint }}
          </NText>
          <div class="asr-row">
            <div style="flex: 1; min-width: 0">
              <div>{{ t.ttsEnable }}</div>
              <NText depth="3" style="font-size: 12px; display: block; margin-top: 4px">
                {{ t.ttsEnableHint }}
              </NText>
            </div>
            <NSwitch
              v-model:value="ttsEnabled"
              size="small"
              :disabled="!tts.status.supported || !tts.status.installed"
            />
          </div>
          <NText depth="3" style="font-size: 12px; display: block; margin-top: 12px">
            {{ tts.status.voiceLabel }} ·
            {{ tts.status.installed ? t.ttsInstalled : t.ttsNotInstalled }} ·
            ≈{{ tts.status.voiceDiskMb + tts.status.runtimeDiskMb }}MB
          </NText>
          <NText
            v-if="tts.status.runtimeArchiveHint"
            depth="3"
            style="font-size: 12px; display: block; margin-top: 6px; word-break: break-all"
          >
            {{ t.ttsRuntimeHint(tts.status.runtimeArchiveHint) }}
          </NText>
          <NText
            v-if="!tts.status.supported"
            depth="3"
            type="warning"
            style="font-size: 12px; display: block; margin-top: 8px"
          >
            {{ t.ttsUnsupported }}
          </NText>
          <NSpace :size="8" style="margin-top: 12px">
            <NButton
              size="small"
              type="primary"
              :disabled="!tts.status.supported || tts.status.installing || tts.status.installed"
              :loading="tts.status.installing"
              @click="onTtsInstall"
            >
              {{ t.ttsInstall }}
            </NButton>
            <NButton
              size="small"
              :disabled="!tts.status.installed || tts.status.installing"
              @click="onTtsUninstall"
            >
              {{ t.ttsUninstall }}
            </NButton>
          </NSpace>
          <div v-if="tts.status.installing || tts.progress" style="margin-top: 12px">
            <NText depth="3" style="font-size: 12px; display: block; margin-bottom: 6px">
              {{ tts.progress?.message || t.ttsInstalling }}
            </NText>
            <NProgress
              v-if="ttsProgressPct != null"
              type="line"
              :percentage="ttsProgressPct"
              :show-indicator="true"
              processing
            />
          </div>
        </div>
        </div>
      </NTabPane>
    </NTabs>

    <template #footer>
      <div class="footer">
        <NButton @click="emit('close')">{{ t.close }}</NButton>
      </div>
    </template>
  </NModal>
</template>

<style scoped>
.voice-settings-modal :deep(.n-card) {
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
}

.voice-settings-modal :deep(.n-card__content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.voice-tabs {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.voice-tabs :deep(.n-tabs-nav) {
  flex-shrink: 0;
}

.voice-tabs :deep(.n-tabs-pane-wrapper) {
  flex: 1 1 auto;
  min-height: 0;
}

.voice-tabs :deep(.n-tab-pane) {
  height: 100%;
}

.voice-tab-scroll {
  max-height: min(58vh, 520px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
  box-sizing: border-box;
}

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
.asr-wake-words-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
.footer {
  display: flex;
  justify-content: flex-end;
}

/* Redesigned card layout */
.asr-scroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
  border-radius: 10px;
  padding: 14px;
  background: var(--bg-elevated, transparent);
  display: flex;
  flex-direction: column;
}

.card-head {
  margin-bottom: 12px;
}

.card-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--fg, #1f2328);
}

.card-hint {
  display: block;
  font-size: 12px;
  margin-top: 4px;
}

.backend-seg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.seg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  background: transparent;
  color: var(--fg-muted, #57606a);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease;
}

.seg-btn:hover {
  border-color: var(--accent-border, #a5b4fc);
}

.seg-btn.on {
  border-color: var(--accent, #4f6ef7);
  background: var(--accent-soft, rgba(79, 110, 247, 0.1));
  color: var(--accent, #4f6ef7);
  font-weight: 600;
}

.backend-panel {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border, rgba(128, 128, 128, 0.2));
  display: flex;
  flex-direction: column;
}

.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
}

@media (max-width: 520px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field > span {
  font-size: 11.5px;
  color: var(--fg-muted, #57606a);
}

.cloud-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.test-result {
  font-size: 12px;
  display: block;
  margin-top: 8px;
  word-break: break-all;
}

.note {
  font-size: 11.5px;
  display: block;
  margin-top: 8px;
  line-height: 1.5;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.status-text {
  flex: 1;
  min-width: 0;
}

.status-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.sub-section {
  margin-top: 14px;
}

.sub-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg, #1f2328);
}

.sub-hint {
  font-size: 12px;
  display: block;
  margin: 4px 0 8px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
}

.setting-row + .setting-row {
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.15));
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-name {
  font-size: 12.5px;
  color: var(--fg, #1f2328);
}

.setting-hint {
  font-size: 12px;
  display: block;
  margin-top: 3px;
}

.setting-block {
  padding-top: 10px;
  border-top: 1px solid var(--border, rgba(128, 128, 128, 0.15));
}

.asr-wake-words-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

:root.dark .card {
  border-color: rgba(255, 255, 255, 0.14);
}

:root.dark .card-title,
:root.dark .setting-name,
:root.dark .sub-title {
  color: #e6edf3;
}

:root.dark .seg-btn {
  color: #8b949e;
}

:root.dark .seg-btn.on {
  background: rgba(79, 110, 247, 0.18);
}
</style>
