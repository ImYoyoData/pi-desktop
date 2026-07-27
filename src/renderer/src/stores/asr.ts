import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AsrInstallProgress, AsrStatus, AsrStreamEvent } from "../../../shared/asr";
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
  const m = raw.match(/^ASR_DOWNLOAD_(TIMEOUT|FAILED)\|([^\n|]+)(?:\|.*)?$/);
  if (m?.[2]) return downloadFailed(m[2]);
  return formatAsrRuntimeError(raw);
}

/** Friendly copy for CUDA crash / native exit codes (and IPC wrappers). */
export function formatAsrRuntimeError(err: unknown, fallback = ""): string {
  const raw = unwrapIpcError(err);
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
  if (/exited with code\s+3221225477/i.test(raw) || /0xC0000005/i.test(raw)) {
    return t.asrCudaCrashHint;
  }
  return raw || fallback;
}

const emptyStatus = (): AsrStatus => ({
  enabled: true,
  supported: true,
  installed: false,
  modelPath: null,
  binaryPath: null,
  diskMb: 640,
  ramMb: 900,
  binaryMb: 10,
  modelLabel: "Qwen3-ASR 0.6B (Q4_K)",
  installing: false,
  busy: false,
  gpuBackend: "cpu",
  gpuDeviceLabel: "CPU",
  gpuKind: "cpu",
  runtimeArchiveHint: null,
  lastError: null,
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

  const micVisible = computed(() => status.value.enabled && status.value.supported);
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

  async function runInstall(action: () => Promise<AsrStatus>): Promise<void> {
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
      // Clear sticky "installing" progress after failure so UI can settle
      if (progress.value?.phase === "error") {
        // keep error message briefly for settings panel; caller toasts separately
      }
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

  async function transcribe(pcmBase64: string, sampleRate: number): Promise<string> {
    transcribing.value = true;
    try {
      return await window.api.asr.transcribe(pcmBase64, sampleRate);
    } finally {
      transcribing.value = false;
    }
  }

  return {
    status,
    progress,
    recording,
    transcribing,
    queueDepth,
    micVisible,
    installing,
    refresh,
    setEnabled,
    install,
    installFromUrl,
    importLocal,
    reinstallRuntime,
    importRuntimeArchive,
    uninstall,
    bindProgress,
    streamStart,
    streamPush,
    streamStop,
    bindStreamEvents,
    transcribe,
  };
});
