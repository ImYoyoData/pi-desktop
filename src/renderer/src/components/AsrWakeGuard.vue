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
  syncWakeListen,
  stopWakeListen,
} from "@renderer/utils/asr-wake-listen";
import { t } from "@renderer/i18n";

const asr = useAsrStore();
const notify = useNotifyStore();
const messageApi = useMessage();

/** Prevent overlapping sync from rapid pref / pause toggles. */
let wakeSyncGen = 0;

function wakeListenDeps() {
  return {
    getWakeWords: () => asr.status.wakeWords || "",
    streamStart: () => asr.streamStart(),
    streamPush: (pcmBase64: string) => asr.streamPush(pcmBase64),
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
  const desired = asr.residentActive && !paused;
  const result = await syncWakeListen(desired, wakeListenDeps());
  if (gen !== wakeSyncGen) return;
  if (!result.ok && desired && result.error) {
    if (/permission denied|NotAllowed|PermissionDenied|麦克风/i.test(result.error)) {
      messageApi.error(t.asrMicDenied);
    } else if (/No microphone|NotFound|DevicesNotFound|未检测/i.test(result.error)) {
      messageApi.error(t.asrMicMissing);
    } else {
      messageApi.error(`${t.asrWakeListenFail}: ${result.error}`, { duration: 5000 });
    }
  }
}

let offTtsSpeaking: (() => void) | undefined;

onMounted(() => {
  void asr.refresh().then(() => {
    void syncResidentWakeListen();
  });
  const tts = useTtsStore();
  void tts.refresh();
  offTtsSpeaking = tts.bindSpeaking();
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
