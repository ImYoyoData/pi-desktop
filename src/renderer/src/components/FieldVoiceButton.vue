<script setup lang="ts">
/**
 * Compact mic control for text fields (ask_user / extension UI).
 * Click to start → click again to stop, transcribe, emit text; parent focuses the input.
 */
import { onUnmounted, ref } from "vue";
import { NButton, NIcon, useMessage } from "naive-ui";
import { MicOutline, StopCircleOutline } from "@vicons/ionicons5";
import { formatAsrInstallError, formatAsrRuntimeError, isAsrInstallCancelled, useAsrStore } from "@renderer/stores/asr";
import { useMediaStore } from "@renderer/stores/media";
import { startVoiceRecord, type VoiceRecordSession } from "@renderer/utils/pcm-capture";
import { stopWakeListen } from "@renderer/utils/asr-wake-listen";
import AsrInstallConfirmModal from "@renderer/components/AsrInstallConfirmModal.vue";
import { scrubAsrHallucination } from "../../../shared/asr";
import { t } from "@renderer/i18n";

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  /** Transcribed text ready to append/write into the field. */
  text: [value: string];
  /** Fired after success/cancel so the parent can refocus the input. */
  done: [];
}>();

const asr = useAsrStore();
const media = useMediaStore();
const messageApi = useMessage();

const recording = ref(false);
const pending = ref(false);
let session: VoiceRecordSession | null = null;
let gen = 0;
let confirming = false;

onUnmounted(() => {
  cancel({ resumeWake: true });
});

async function ensureReady(): Promise<boolean> {
  if (ensureReadyFlight) return ensureReadyFlight;
  ensureReadyFlight = doEnsureReady().finally(() => {
    ensureReadyFlight = null;
  });
  return ensureReadyFlight;
}

let ensureReadyFlight: Promise<boolean> | null = null;

async function doEnsureReady(): Promise<boolean> {
  if (!(asr.status.residentModel && asr.status.installed && asr.status.enabled)) {
    await asr.refresh();
  }
  if (!asr.status.supported) {
    messageApi.warning(t.asrUnsupported);
    return false;
  }
  if (!asr.status.enabled) {
    messageApi.warning(t.asrDisabled);
    return false;
  }
  if (asr.status.installed) return true;
  if (asr.installing) {
    try {
      await asr.install();
      return asr.status.installed;
    } catch (err) {
      if (isAsrInstallCancelled(err)) return false;
      messageApi.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
      return false;
    }
  }
  const ok = await promptAsrInstallConfirm();
  if (!ok) return false;
  try {
    await asr.install();
    return true;
  } catch (err) {
    if (isAsrInstallCancelled(err)) return false;
    messageApi.error(formatAsrInstallError(err, t.asrDownloadFailed), { duration: 6000 });
    return false;
  }
}

const asrInstallConfirmOpen = ref(false);
let asrInstallConfirmResolve: ((ok: boolean) => void) | null = null;

function promptAsrInstallConfirm(): Promise<boolean> {
  if (asrInstallConfirmResolve) {
    asrInstallConfirmResolve(false);
    asrInstallConfirmResolve = null;
  }
  asrInstallConfirmOpen.value = true;
  return new Promise((resolve) => {
    asrInstallConfirmResolve = resolve;
  });
}

function onAsrInstallConfirm(): void {
  asrInstallConfirmOpen.value = false;
  asrInstallConfirmResolve?.(true);
  asrInstallConfirmResolve = null;
}

function onAsrInstallConfirmCancel(): void {
  asrInstallConfirmOpen.value = false;
  asrInstallConfirmResolve?.(false);
  asrInstallConfirmResolve = null;
}

function cancel(opts?: { resumeWake?: boolean }): void {
  gen += 1;
  session?.abort();
  session = null;
  recording.value = false;
  pending.value = false;
  confirming = false;
  asr.recording = false;
  if (opts?.resumeWake !== false) asr.setWakePaused(false);
}

async function confirm(): Promise<void> {
  if (!session || confirming) return;
  confirming = true;
  const myGen = gen;
  const active = session;
  session = null;
  recording.value = false;
  asr.recording = false;
  pending.value = true;
  try {
    const { pcm, sampleRate } = await active.stop();
    if (myGen !== gen) return;
    if (!pcm || pcm.length === 0) {
      messageApi.warning(t.voiceEmpty);
      return;
    }
    const ready = await ensureReady();
    if (myGen !== gen) return;
    if (!ready) return;
    const raw = await asr.transcribe(pcm, sampleRate);
    if (myGen !== gen) return;
    const text = scrubAsrHallucination(raw);
    if (!text) {
      messageApi.warning(t.voiceEmpty);
      return;
    }
    emit("text", text);
  } catch (err) {
    if (myGen !== gen) return;
    const raw = err instanceof Error ? err.message : String(err);
    messageApi.error(formatAsrRuntimeError(raw, t.asrFail), { duration: 5500 });
  } finally {
    confirming = false;
    pending.value = false;
    asr.setWakePaused(false);
    emit("done");
  }
}

async function onClick(): Promise<void> {
  if (props.disabled || asr.installing || pending.value) return;
  if (recording.value) {
    await confirm();
    return;
  }
  if (asr.status.supported === false) {
    messageApi.warning(t.asrUnsupported);
    return;
  }
  if (asr.status.enabled === false) {
    messageApi.warning(t.asrDisabled);
    return;
  }

  asr.setWakePaused(true);
  await stopWakeListen();
  media.stopAll();

  try {
    session = await startVoiceRecord({
      onLevel: () => {
        /* meter optional for compact control */
      },
    });
    recording.value = true;
    asr.recording = true;
  } catch (err) {
    asr.setWakePaused(false);
    const raw = err instanceof Error ? err.message : String(err);
    let msg = raw;
    if (/NotAllowedError|Permission/i.test(raw)) msg = t.asrMicDenied;
    else if (/NotFoundError|DevicesNotFound/i.test(raw)) msg = t.asrMicMissing;
    messageApi.error(msg, { duration: 5000 });
    emit("done");
  }
}
</script>

<template>
  <NButton
    quaternary
    circle
    size="tiny"
    class="field-voice-btn pi-interactive"
    :class="{ recording, pending }"
    :disabled="disabled || pending"
    :loading="pending"
    :title="recording ? t.voiceConfirm : t.voiceInput"
    :aria-label="recording ? t.voiceConfirm : t.voiceInput"
    @click="onClick"
  >
    <template #icon>
      <NIcon :component="recording ? StopCircleOutline : MicOutline" :size="16" />
    </template>
  </NButton>
  <AsrInstallConfirmModal
    :show="asrInstallConfirmOpen"
    @confirm="onAsrInstallConfirm"
    @cancel="onAsrInstallConfirmCancel"
  />
</template>

<style scoped>
.field-voice-btn.recording {
  color: var(--error, #d03050);
  background: color-mix(in srgb, var(--error, #d03050) 12%, transparent);
}
</style>
