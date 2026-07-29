import { defineStore } from "pinia";
import { ref } from "vue";
import type { TtsInstallProgress, TtsStatus } from "../../../shared/tts";

const emptyStatus = (): TtsStatus => ({
  enabled: false,
  supported: true,
  installed: false,
  voicePath: null,
  binaryPath: null,
  voiceDiskMb: 64,
  runtimeDiskMb: 24,
  voiceLabel: "Piper zh-CN-huayan-medium",
  installing: false,
  speaking: false,
  runtimeArchiveHint: null,
  lastError: null,
});

export const useTtsStore = defineStore("tts", () => {
  const status = ref<TtsStatus>(emptyStatus());
  const progress = ref<TtsInstallProgress | null>(null);
  /** Message id currently being spoken (manual or auto); null when idle. */
  const speakingMessageId = ref<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      status.value = await window.api.tts.status();
    } catch {
      status.value = { ...emptyStatus(), supported: false };
    }
    if (!status.value.speaking) speakingMessageId.value = null;
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    status.value = await window.api.tts.setEnabled(enabled);
  }

  async function install(): Promise<void> {
    progress.value = {
      phase: "binary",
      receivedBytes: 0,
      totalBytes: null,
      message: "Starting…",
    };
    try {
      status.value = await window.api.tts.install();
    } finally {
      progress.value = null;
      await refresh();
    }
  }

  async function uninstall(): Promise<void> {
    status.value = await window.api.tts.uninstall();
    speakingMessageId.value = null;
  }

  async function stopSpeak(): Promise<void> {
    speakingMessageId.value = null;
    status.value = await window.api.tts.stop();
  }

  /** Auto-speak after turn complete — respects enabled switch. */
  function speakReply(text: string, messageId?: string): void {
    if (!status.value.enabled || !status.value.installed) return;
    void speakNow(text, messageId ?? null);
  }

  /** Manual speak from message actions — stops any current playback first. */
  async function speakManual(messageId: string, text: string): Promise<"ok" | "stopped" | "failed"> {
    if (!text.trim()) return "failed";
    if (speakingMessageId.value === messageId && status.value.speaking) {
      await stopSpeak();
      return "stopped";
    }
    const ok = await speakNow(text, messageId);
    return ok ? "ok" : "failed";
  }

  async function speakNow(text: string, messageId: string | null): Promise<boolean> {
    if (!text.trim()) return false;
    // Main stops any in-flight playback before starting the next.
    speakingMessageId.value = messageId;
    status.value = { ...status.value, speaking: true };
    const result = await window.api.tts.speak(text);
    if (!result.ok) {
      if (speakingMessageId.value === messageId) speakingMessageId.value = null;
      status.value = { ...status.value, speaking: false };
      if (result.message && !/not installed|Nothing|Stopped/i.test(result.message)) {
        console.warn("[tts]", result.message);
      }
      return false;
    }
    void refresh();
    return true;
  }

  function bindProgress(): () => void {
    return window.api.tts.onProgress((p) => {
      progress.value = p;
    });
  }

  function bindSpeaking(): () => void {
    return window.api.tts.onSpeaking((payload) => {
      status.value = { ...status.value, speaking: payload.speaking };
      if (!payload.speaking) speakingMessageId.value = null;
    });
  }

  return {
    status,
    progress,
    speakingMessageId,
    refresh,
    setEnabled,
    install,
    uninstall,
    stopSpeak,
    speakReply,
    speakManual,
    bindProgress,
    bindSpeaking,
  };
});
