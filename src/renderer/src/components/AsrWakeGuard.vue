<script setup lang="ts">
/**
 * App-root resident wake lifecycle — always mounted so listen/model warm
 * work without an open chat session. On match: cue + `pi-asr-wake` for Composer.
 */
import { onMounted, onUnmounted, watch } from "vue";
import { useMessage } from "naive-ui";
import { useAsrStore } from "@renderer/stores/asr";
import { useTtsStore } from "@renderer/stores/tts";
import { useNotifyStore } from "@renderer/stores/notify";
import {
  ASR_VOICE_WAKE_EVENT,
  startPreloadStream,
  stopPreloadStream,
  suspendWakeListen,
  syncWakeListen,
  stopWakeListen,
} from "@renderer/utils/asr-wake-listen";
import { t } from "@renderer/i18n";

const asr = useAsrStore();
const notify = useNotifyStore();
const messageApi = useMessage();

/** Prevent overlapping sync from rapid pref / pause toggles. */
let wakeSyncGen = 0;
/** Warn once per wake-request when the model isn't ready (avoid toast spam). */
let warnedWakeMissing = false;

function wakeListenDeps() {
  return {
    getWakeWords: () => asr.status.wakeWords || "",
    streamStart: () => asr.streamStart(),
    streamPush: (pcm: Int16Array) => asr.streamPush(pcm),
    streamStop: () => asr.streamStop(),
    bindStreamEvents: (onEvent: Parameters<typeof asr.bindStreamEvents>[0]) =>
      asr.bindStreamEvents(onEvent),
    onWake: async () => {
      await notify.playChime();
      // Same entry as hotkey: Composer listens; no-op if no session/Composer.
      window.dispatchEvent(new CustomEvent(ASR_VOICE_WAKE_EVENT));
      // Match path already stopped wake; resume after tick if Composer did not claim dictation.
      queueMicrotask(() => {
        if (!asr.wakePaused) void syncResidentWakeListen();
      });
    },
  };
}

async function syncResidentWakeListen(): Promise<void> {
  const gen = ++wakeSyncGen;
  const paused =
    asr.wakePaused || asr.installing || asr.capturingHotkey;

  // Wake requested but not runnable (model missing / unsupported) — say why.
  if (asr.status.wakeEnabled && !asr.wakeActive && !paused && !warnedWakeMissing) {
    warnedWakeMissing = true;
    if (!asr.status.installed) {
      messageApi.warning(t.asrWakeModelNeeded, { duration: 6000 });
    } else {
      messageApi.warning(t.asrWakeUnavailable, { duration: 6000 });
    }
  }
  if (!asr.status.wakeEnabled || asr.wakeActive) warnedWakeMissing = false;

  // Voice wake = always-on recognition (separate toggle).
  if (asr.wakeActive) {
    await stopPreloadStream();
    if (paused) {
      // Dictation / install: pause the wake mic but keep the stream warm.
      suspendWakeListen();
      return;
    }
    const result = await syncWakeListen(true, wakeListenDeps());
    if (gen !== wakeSyncGen) return;
    if (!result.ok && result.error) {
      if (/permission denied|NotAllowed|PermissionDenied|\u9ea6\u514b\u98ce/i.test(result.error)) {
        messageApi.error(t.asrMicDenied);
      } else if (/No microphone|NotFound|DevicesNotFound|\u672a\u68c0\u6d4b/i.test(result.error)) {
        messageApi.error(t.asrMicMissing);
      } else {
        messageApi.error(`${t.asrWakeListenFail}: ${result.error}`, { duration: 5000 });
      }
    }
    return;
  }

  // Model resident = preload only (no mic, no wake).
  if (asr.preloadActive) {
    await syncWakeListen(false, wakeListenDeps());
    if (paused) {
      await stopPreloadStream();
    } else {
      try {
        await startPreloadStream(wakeListenDeps());
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        if (gen === wakeSyncGen) {
          messageApi.error(`${t.asrWakeListenFail}: ${raw}`, { duration: 5000 });
        }
      }
    }
    return;
  }

  // Neither enabled — tear everything down.
  await syncWakeListen(false, wakeListenDeps());
  await stopPreloadStream();
}
let offTtsSpeaking: (() => void) | undefined;

onMounted(() => {
  // Defer ASR/TTS warm-up until the shell is idle — avoids fighting first paint
  // / session hydrate on slower CPUs.
  const warm = (): void => {
    void asr.refresh().then(() => {
      void syncResidentWakeListen();
    });
    const tts = useTtsStore();
    void tts.refresh();
    offTtsSpeaking = tts.bindSpeaking();
  };
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === "function") {
    ric(warm, { timeout: 2200 });
  } else {
    window.setTimeout(warm, 1200);
  }
});

onUnmounted(() => {
  void stopWakeListen();
  offTtsSpeaking?.();
  offTtsSpeaking = undefined;
});

watch(
  () =>
    [
      asr.status.residentModel,
      asr.status.wakeEnabled,
      asr.status.enabled,
      asr.status.installed,
      asr.status.supported,
      asr.status.wakeWords,
      asr.installing,
      asr.capturingHotkey,
      asr.wakePaused,
    ] as const,
  () => {
    void syncResidentWakeListen();
  },
);
</script>

<template>
  <!-- Headless: resident wake listen only -->
</template>
