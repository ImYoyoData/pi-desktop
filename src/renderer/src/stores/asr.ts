import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AsrInstallProgress, AsrStatus } from "../../../shared/asr";

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
  busy: false,
  lastError: null,
});

export const useAsrStore = defineStore("asr", () => {
  const status = ref<AsrStatus>(emptyStatus());
  const progress = ref<AsrInstallProgress | null>(null);
  const recording = ref(false);
  const transcribing = ref(false);

  const micVisible = computed(() => status.value.enabled && status.value.supported);
  const installing = computed(
    () =>
      status.value.busy ||
      (progress.value !== null &&
        progress.value.phase !== "done" &&
        progress.value.phase !== "error"),
  );

  async function refresh(): Promise<void> {
    status.value = await window.api.asr.status();
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    status.value = await window.api.asr.setEnabled(enabled);
  }

  async function install(): Promise<void> {
    status.value = { ...status.value, busy: true, lastError: null };
    progress.value = {
      phase: "binary",
      receivedBytes: 0,
      totalBytes: null,
      message: "Starting…",
    };
    try {
      status.value = await window.api.asr.install();
      progress.value = {
        phase: "done",
        receivedBytes: 0,
        totalBytes: null,
        message: "Ready",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress.value = {
        phase: "error",
        receivedBytes: 0,
        totalBytes: null,
        message,
      };
      throw err;
    } finally {
      await refresh();
    }
  }

  async function uninstall(): Promise<void> {
    status.value = await window.api.asr.uninstall();
    progress.value = null;
  }

  function bindProgress(): () => void {
    return window.api.asr.onProgress((p) => {
      progress.value = p;
      if (p.phase !== "done" && p.phase !== "error") {
        status.value = { ...status.value, busy: true };
      }
    });
  }

  return {
    status,
    progress,
    recording,
    transcribing,
    micVisible,
    installing,
    refresh,
    setEnabled,
    install,
    uninstall,
    bindProgress,
  };
});
