<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { CheckmarkOutline, CloseOutline } from "@vicons/ionicons5";
import { t } from "@renderer/i18n";

const props = defineProps<{
  /** Latest mic level 0..1 */
  level: number;
  /** True while ASR is running after confirm */
  busy?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const BAR_COUNT = 40;
const levels = ref<number[]>(Array.from({ length: BAR_COUNT }, () => 0.08));
const startedAt = ref(Date.now());
const nowTick = ref(Date.now());
let timer: ReturnType<typeof setInterval> | null = null;

const elapsedLabel = computed(() => {
  const sec = Math.max(0, Math.floor((nowTick.value - startedAt.value) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
});

watch(
  () => props.level,
  (v) => {
    const next = levels.value.slice(1);
    next.push(Math.max(0.06, Math.min(1, v)));
    levels.value = next;
  },
);

onMounted(() => {
  startedAt.value = Date.now();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 250);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  timer = null;
});
</script>

<template>
  <div class="voice-bar" role="group" :aria-label="t.voiceRecording">
    <div class="wave" aria-hidden="true">
      <span
        v-for="(h, i) in levels"
        :key="i"
        class="bar"
        :style="{ height: `${Math.round(10 + h * 18)}px` }"
      />
    </div>
    <span class="time">{{ elapsedLabel }}</span>
    <button
      type="button"
      class="icon-btn"
      :disabled="busy"
      :title="t.voiceCancel"
      :aria-label="t.voiceCancel"
      @click="emit('cancel')"
    >
      <NIcon :component="CloseOutline" :size="18" />
    </button>
    <button
      type="button"
      class="icon-btn confirm"
      :disabled="busy"
      :title="busy ? t.voiceTranscribing : t.voiceConfirm"
      :aria-label="busy ? t.voiceTranscribing : t.voiceConfirm"
      @click="emit('confirm')"
    >
      <NIcon :component="CheckmarkOutline" :size="18" />
    </button>
  </div>
</template>

<style scoped>
.voice-bar {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 14px;
  border-radius: 999px;
  background: var(--bg-elevated, #fff);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08);
  max-width: 100%;
}

.wave {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  min-width: 140px;
  flex: 1;
}

.bar {
  width: 2px;
  border-radius: 1px;
  background: #9aa0a6;
  transition: height 60ms linear;
}

.time {
  font-variant-numeric: tabular-nums;
  font-size: 13px;
  color: #9aa0a6;
  min-width: 2.5em;
  text-align: right;
  user-select: none;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #9aa0a6;
  cursor: pointer;
  padding: 0;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #5f6368;
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.icon-btn.confirm {
  color: #5f6368;
}

:root.dark .voice-bar,
.dark .voice-bar {
  background: var(--bg-elevated, #2a2a2a);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35);
}

:root.dark .bar,
.dark .bar {
  background: #9aa0a6;
}
</style>
