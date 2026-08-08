import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AsrCloudConfig, AsrInstallProgress, AsrStatus, AsrStreamEvent } from "../../../shared/asr";
import { DEFAULT_ASR_WAKE_WORDS } from "../../../shared/asr-wake";
import { DEFAULT_ASR_WAKE_HOTKEY } from "../../../shared/hotkey";
import { t } from "@renderer/i18n";

/** Electron IPC wraps as `Error invoking remote method 'x': <real message>`. */
function unwrapIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.match(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?(.*)$/s);
  return (m?.[1] ?? raw).trim() || raw;
}

/** Map main-process ASCII error tokens to UI copy. */
export function formatAsrInstallError(err: unknown, downloadFailed: (url: string) => string): string {
  const raw = unwrapIpcError(err);
  if (isAsrInstallCancelled(raw)) return t.asrInstallCancelled;
  const m = raw.match(/^ASR_DOWNLOAD_(TIMEOUT|FAILED)\|([^\n|]+)(?:\|.*)?$/);
  if (m?.[2]) return downloadFailed(m[2]);
  return formatAsrRuntimeError(raw);
}

/** True when the user aborted an in-flight ASR install/download. */
export function isAsrInstallCancelled(err: unknown): boolean {
  const raw = typeof err === "string" ? err : unwrapIpcError(err);
  return /ASR_INSTALL_CANCELLED/i.test(raw);
}

/** Friendly copy for CUDA crash / native exit codes (and IPC wrappers). */
export function formatAsrRuntimeError(err: unknown, fallback = ""): string {
  const raw = unwrapIpcError(err);
  if (isAsrInstallCancelled(raw)) return t.asrInstallCancelled;
  const cuda = raw.match(/^ASR_CUDA_CRASH\|([^|]*)\|?(.*)$/s);
  if (cuda) {
    const tail = (cuda[2] || "").trim();
    if (/Vulkan fallback failed/i.test(tail)) {
      return t.asrCudaCrashFallbackFail;
    }
    if (/Switched to Vulkan/i.test(tail) || /tap the mic/i.test(tail)) {
      return t.asrCudaCrashRetry;
    }
    return t.asrCudaCrashRetry;
  }
  if (/^ASR_GPU_INIT_FAILED\|/i.test(raw) || /ggml_vulkan:/i.test(raw)) {
    return t.asrGpuInitFailed;
  }
  if (/exited with code\s+3221225477/i.test(raw) || /0xC0000005/i.test(raw)) {
    return t.asrCudaCrashHint;
  }
  // Never surface raw ggml device enumeration spam in toasts.
  if (/^ggml[_-]/im.test(raw) && raw.split(/\n/).every((l) => !l.trim() || /^ggml|_init_gpu|Vulkan\d*/i.test(l))) {
    return t.asrGpuInitFailed;
  }
  return raw || fallback;
}

const emptyStatus = (): AsrStatus => ({
  enabled: true,
  supported: true,
  installed: false,
  modelPath: null,
  binaryPath: null,
  diskMb: 140,
  ramMb: 420,
  binaryMb: 10,
  modelLabel: "SenseVoiceSmall (Q4_K)",
  installing: false,
  busy: false,
  gpuBackend: "cpu",
  gpuDeviceLabel: "CPU",
  gpuKind: "cpu",
  gpuPreference: "auto",
  gpuOptions: [{ id: "auto", label: "Auto", backend: "cpu", kind: "cpu" }],
  runtimeMatchesPreference: true,
  runtimeArchiveHint: null,
  downloadMirror: "auto",
  wakeHotkey: DEFAULT_ASR_WAKE_HOTKEY,
  residentModel: true,
  wakeEnabled: false,
  wakeWords: DEFAULT_ASR_WAKE_WORDS,
  lastError: null,
  backend: null,
  cloudConfigured: false,
});

export const useAsrStore = defineStore("asr", () => {
  const status = ref<AsrStatus>(emptyStatus());
  const progress = ref<AsrInstallProgress | null>(null);
  const recording = ref(false);
  const transcribing = ref(false);
  /** Pending utterance jobs waiting behind the current transcription. */
  const queueDepth = ref(0);
  /** Local lock so install modal never tracks transcription busy. */
  const installInFlight = ref(false);
  /** True while settings is listening for a new wake chord — Composer ignores wake. */
  const capturingHotkey = ref(false);
  /** First-click backend chooser modal visibility. */
  const backendPickerOpen = ref(false);
  let backendPickerResolve: ((chosen: boolean) => void) | null = null;
  /** True while Composer dictation (record / pending) — App-level wake listen pauses. */
  const wakePaused = ref(false);

  const micVisible = computed(
    () => status.value.enabled && (status.value.supported || status.value.cloudConfigured),
  );
  /** Only true while installing runtime/model — never during transcription. */
  const installing = computed(() => installInFlight.value || status.value.installing);

  async function refresh(): Promise<void> {
    status.value = await window.api.asr.status();
    // Clear stale install progress once ready
    if (status.value.installed && !status.value.installing && !installInFlight.value) {
      if (progress.value && progress.value.phase !== "error") {
        progress.value = null;
      }
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    status.value = await window.api.asr.setEnabled(enabled);
  }

  async function setGpuPreference(preference: string): Promise<AsrStatus> {
    status.value = await window.api.asr.setGpuPreference(preference);
    return status.value;
  }

  async function setDownloadMirror(mirror: string): Promise<AsrStatus> {
    status.value = await window.api.asr.setDownloadMirror(mirror);
    return status.value;
  }

  /** Coalesce concurrent install/reinstall IPC calls onto one in-flight promise. */
  let installFlight: Promise<void> | null = null;

  async function runInstall(action: () => Promise<AsrStatus>): Promise<void> {
    if (installFlight) {
      await installFlight;
      return;
    }

    installFlight = (async () => {
      installInFlight.value = true;
      progress.value = {
        phase: "binary",
        receivedBytes: 0,
        totalBytes: null,
        message: "Starting…",
      };
      try {
        status.value = await action();
        progress.value = {
          phase: "done",
          receivedBytes: 0,
          totalBytes: null,
          message: "Ready",
        };
      } catch (err) {
        const message = unwrapIpcError(err);
        if (isAsrInstallCancelled(message)) {
          progress.value = null;
          throw new Error("ASR_INSTALL_CANCELLED");
        }
        progress.value = {
          phase: "error",
          receivedBytes: 0,
          totalBytes: null,
          message,
        };
        throw new Error(message);
      } finally {
        installInFlight.value = false;
        await refresh();
      }
    })();

    try {
      await installFlight;
    } finally {
      installFlight = null;
    }
  }

  async function install(): Promise<void> {
    await runInstall(() => window.api.asr.install());
  }

  async function installFromUrl(url: string): Promise<void> {
    await runInstall(() => window.api.asr.installFromUrl(url));
  }

  /** Opens file picker and imports the selected .gguf. Returns false if cancelled. */
  async function importLocal(): Promise<boolean> {
    const filePath = await window.api.asr.pickModel();
    if (!filePath) return false;
    await runInstall(() => window.api.asr.importModel(filePath));
    return true;
  }

  async function reinstallRuntime(): Promise<void> {
    await runInstall(() => window.api.asr.reinstallRuntime());
  }

  /** Opens file picker and imports a local runtime zip/tar.gz. Returns false if cancelled. */
  async function importRuntimeArchive(): Promise<boolean> {
    const filePath = await window.api.asr.pickRuntimeArchive();
    if (!filePath) return false;
    await runInstall(() => window.api.asr.importRuntime(filePath));
    return true;
  }

  async function cancelInstall(): Promise<void> {
    await window.api.asr.cancelInstall();
  }

  async function uninstall(): Promise<void> {
    status.value = await window.api.asr.uninstall();
    progress.value = null;
    installInFlight.value = false;
  }

  function bindProgress(): () => void {
    return window.api.asr.onProgress((p) => {
      if (!installInFlight.value && !status.value.installing) return;
      progress.value = p;
    });
  }

  async function streamStart(): Promise<void> {
    status.value = await window.api.asr.streamStart();
  }

  function streamPush(pcmBase64: string): void {
    void window.api.asr.streamPush(pcmBase64);
  }

  async function streamStop(): Promise<void> {
    status.value = await window.api.asr.streamStop();
    transcribing.value = false;
  }

  function bindStreamEvents(onEvent: (event: AsrStreamEvent) => void): () => void {
    return window.api.asr.onStreamEvent(onEvent);
  }

  async function setBackend(backend: "local" | "cloud" | null): Promise<void> {
    status.value = await window.api.asr.setBackend(backend ?? "");
  }

  async function getCloudConfig(): Promise<{ backend: "local" | "cloud" | null; cloud: AsrCloudConfig | null }> {
    return window.api.asr.getCloudConfig();
  }

  async function setCloudConfig(cloud: AsrCloudConfig): Promise<void> {
    status.value = await window.api.asr.setCloudConfig(cloud);
  }

  async function testCloud(): Promise<{ ok: boolean; message: string }> {
    return window.api.asr.testCloud();
  }

  function closeBackendPicker(): void {
    backendPickerOpen.value = false;
    backendPickerResolve?.(false);
    backendPickerResolve = null;
  }

  function resolveBackendPick(chosen: boolean): void {
    backendPickerOpen.value = false;
    const resolve = backendPickerResolve;
    backendPickerResolve = null;
    resolve?.(chosen);
  }

  /**
   * On first mic click: show the backend chooser and wait for the user to pick.
   * Returns false when cancelled.
   */
  function ensureBackendChosen(): Promise<boolean> {
    if (status.value.backend) return Promise.resolve(true);
    if (backendPickerOpen.value) return Promise.resolve(false);
    backendPickerOpen.value = true;
    return new Promise<boolean>((resolve) => {
      backendPickerResolve = resolve;
    });
  }

  async function transcribe(pcm: Int16Array, sampleRate: number): Promise<string> {
    transcribing.value = true;
    try {
      return await window.api.asr.transcribe(pcm, sampleRate);
    } finally {
      transcribing.value = false;
    }
  }

  async function setWakeHotkey(accel: string): Promise<AsrStatus> {
    status.value = await window.api.asr.setWakeHotkey(accel);
    return status.value;
  }

  async function setResidentModel(enabled: boolean): Promise<AsrStatus> {
    status.value = await window.api.asr.setResidentModel(enabled);
    return status.value;
  }

  async function setWakeEnabled(enabled: boolean): Promise<AsrStatus> {
    status.value = await window.api.asr.setWakeEnabled(enabled);
    return status.value;
  }

  async function setWakeWords(raw: string): Promise<AsrStatus> {
    status.value = await window.api.asr.setWakeWords(raw);
    return status.value;
  }

  function setCapturingHotkey(v: boolean): void {
    capturingHotkey.value = v;
  }

  function setWakePaused(v: boolean): void {
    wakePaused.value = v;
  }

  /** True when voice wake listening should run (always-on recognition). */
  const wakeActive = computed(
    () =>
      status.value.wakeEnabled &&
      status.value.enabled &&
      status.value.supported &&
      status.value.installed,
  );
  /** True when the model should be preloaded only (no mic, no wake). */
  const preloadActive = computed(
    () =>
      status.value.residentModel &&
      !status.value.wakeEnabled &&
      status.value.enabled &&
      status.value.supported &&
      status.value.installed,
  );

  return {
    status,
    progress,
    recording,
    transcribing,
    queueDepth,
    capturingHotkey,
    wakePaused,
    micVisible,
    installing,
    wakeActive,
    preloadActive,
    refresh,
    setEnabled,
    setGpuPreference,
    setDownloadMirror,
    setWakeHotkey,
    setResidentModel,
    setWakeEnabled,
    setWakeWords,
    setCapturingHotkey,
    backendPickerOpen,
    ensureBackendChosen,
    resolveBackendPick,
    closeBackendPicker,
    setBackend,
    getCloudConfig,
    setCloudConfig,
    testCloud,
    setWakePaused,
    install,
    installFromUrl,
    importLocal,
    reinstallRuntime,
    importRuntimeArchive,
    cancelInstall,
    uninstall,
    bindProgress,
    streamStart,
    streamPush,
    streamStop,
    bindStreamEvents,
    transcribe,
  };
});
