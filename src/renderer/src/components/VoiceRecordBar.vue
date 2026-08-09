<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef } from "vue";
import { NIcon } from "naive-ui";
import { CheckmarkOutline, CloseOutline } from "@vicons/ionicons5";
import { isLowPowerClient } from "@renderer/utils/low-power";
import { t } from "@renderer/i18n";

/** Non-reactive meter — parent mutates `.level` from the audio thread. */
export type VoiceMeter = { level: number };

const props = defineProps<{
  meter: VoiceMeter;
  /** True while ASR is running after confirm */
  busy?: boolean;
  /** Show stop control when an agent turn is running */
  showStop?: boolean;
  /** Live streaming dictation is active (local backend). */
  streaming?: boolean;
  /** ASR engine is still loading (model not resident yet). */
  starting?: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
  stop: [];
}>();

const lowPower = isLowPowerClient();
/** Fewer bars + lower FPS on weak CPUs so the record UI never fights the mic path. */
const BAR_COUNT = lowPower ? 24 : 48;
const canvasRef = shallowRef<HTMLCanvasElement | null>(null);
const hostRef = shallowRef<HTMLElement | null>(null);
const startedAt = ref(Date.now());
const nowTick = ref(Date.now());

/** Ring of smoothed bar heights 0..1 — mutated only on the rAF path. */
const bars = new Float32Array(BAR_COUNT);
let writeIdx = 0;
let rafId = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
let lastSampleAt = 0;
let cachedBarColor = "";
/**
 * Auto-gain: when the wave approaches the top/bottom edges (≥85%), compress
 * so bars keep headroom and stay visually active instead of pegging.
 */
let envelope = 0.2;
let compressGain = 1;
/** ~30fps low-power / ~60fps otherwise. */
const SAMPLE_MS = lowPower ? 33 : 16;
const SMOOTH = 0.38;
const MAX_DPR = lowPower ? 1 : 2;
/** Start compressing once display amp reaches this fraction of the canvas half-height. */
const COMPRESS_AT = 0.85;
/** After compression, aim peaks around this fraction (leaves motion headroom). */
const COMPRESS_TARGET = 0.72;
const ENVELOPE_ATTACK = 0.45;
const ENVELOPE_RELEASE = 0.06;
const GAIN_ATTACK = 0.28;
const GAIN_RELEASE = 0.08;
const GAIN_MIN = 0.35;
const GAIN_MAX = 1.85;

const elapsedLabel = computed(() => {
  const sec = Math.max(0, Math.floor((nowTick.value - startedAt.value) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
});

function cssColor(name: string, fallback: string): string {
  if (cachedBarColor) return cachedBarColor;
  const el = hostRef.value;
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  cachedBarColor = v || fallback;
  return cachedBarColor;
}

function updateCompressGain(sample: number): void {
  const envRate = sample > envelope ? ENVELOPE_ATTACK : ENVELOPE_RELEASE;
  envelope += (sample - envelope) * envRate;

  // Peak of the visible ring — reacts to loud bursts that already fill the canvas.
  let ringPeak = sample;
  for (let i = 0; i < BAR_COUNT; i++) {
    const v = bars[i] ?? 0;
    if (v > ringPeak) ringPeak = v;
  }
  const peak = Math.max(envelope, ringPeak);
  const projected = peak * compressGain;

  let targetGain = 1;
  if (projected >= COMPRESS_AT || peak >= COMPRESS_AT) {
    // Pull the wave away from the upper/lower edges (~85% → ~72%).
    targetGain = COMPRESS_TARGET / Math.max(peak, 0.08);
  } else if (peak > 0.04 && peak < 0.35) {
    // Quiet speech: gentle makeup so the wave stays lively.
    targetGain = COMPRESS_TARGET / Math.max(peak, 0.12);
  }

  targetGain = Math.min(GAIN_MAX, Math.max(GAIN_MIN, targetGain));
  const gainRate = targetGain < compressGain ? GAIN_ATTACK : GAIN_RELEASE;
  compressGain += (targetGain - compressGain) * gainRate;
}

function draw(): void {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const cssW = canvas.clientWidth || 160;
  const cssH = canvas.clientHeight || 20;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, w, h);

  const barColor = cssColor("--voice-wave", "#9aa0a6");
  const midY = h / 2;
  const gap = Math.max(1 * dpr, (w / BAR_COUNT) * 0.35);
  const barW = Math.max(1 * dpr, (w - gap * (BAR_COUNT - 1)) / BAR_COUNT);
  // Hard ceiling of the drawable half-height; AGC keeps content below COMPRESS_AT of this.
  const maxAmp = midY * 0.96;
  ctx.fillStyle = barColor;

  for (let i = 0; i < BAR_COUNT; i++) {
    const idx = (writeIdx + i) % BAR_COUNT;
    const amp = Math.max(0.06, Math.min(1, (bars[idx] ?? 0.06) * compressGain));
    const edge = Math.min(i, BAR_COUNT - 1 - i);
    const fade = Math.min(1, edge / 6);
    const half = Math.max(dpr, amp * maxAmp * fade);
    const x = i * (barW + gap);
    ctx.globalAlpha = 0.35 + 0.65 * fade;
    ctx.fillRect(x, midY - half, barW, half * 2);
  }
  ctx.globalAlpha = 1;
}

function tick(now: number): void {
  if (now - lastSampleAt >= SAMPLE_MS) {
    lastSampleAt = now;
    const raw = Math.max(0, Math.min(1, props.meter.level));
    const idle = 0.08 + 0.03 * (0.5 + 0.5 * Math.sin(now / 320));
    const target = raw < 0.04 ? idle : Math.max(0.08, raw);
    const prev = bars[(writeIdx + BAR_COUNT - 1) % BAR_COUNT] ?? 0.08;
    const smoothed = prev + (target - prev) * SMOOTH;
    bars[writeIdx] = smoothed;
    writeIdx = (writeIdx + 1) % BAR_COUNT;
    updateCompressGain(smoothed);
  }
  draw();
  rafId = requestAnimationFrame(tick);
}

onMounted(() => {
  startedAt.value = Date.now();
  bars.fill(0.08);
  envelope = 0.2;
  compressGain = 1;
  clockTimer = setInterval(() => {
    nowTick.value = Date.now();
  }, 250);
  rafId = requestAnimationFrame(tick);
});

onUnmounted(() => {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = null;
});
</script>

<template>
  <div ref="hostRef" class="voice-bar" role="group" :aria-label="t.voiceRecording">
    <canvas ref="canvasRef" class="wave" aria-hidden="true" />
    <span class="time">{{ elapsedLabel }}</span>
    <span v-if="starting" class="live starting" role="status" aria-live="polite">
      <i class="live-dot" aria-hidden="true" />{{ t.voiceStarting }}
    </span>
    <span v-else-if="streaming" class="live" role="status" aria-live="polite">
      <i class="live-dot" aria-hidden="true" />{{ t.voiceStreaming }}
    </span>
    <button
      v-if="showStop"
      type="button"
      class="icon-btn stop-btn"
      :disabled="busy"
      :title="t.stop"
      :aria-label="t.stop"
      @mousedown.prevent="emit('stop')"
    >
      <span class="stop-square" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="icon-btn"
      :disabled="busy"
      :title="streaming ? t.voiceClose : t.voiceCancel"
      :aria-label="streaming ? t.voiceClose : t.voiceCancel"
      @mousedown.prevent="emit('cancel')"
    >
      <NIcon :component="CloseOutline" :size="15" />
    </button>
    <button
      v-if="!streaming"
      type="button"
      class="icon-btn confirm"
      :disabled="busy"
      :title="busy ? t.voiceTranscribing : t.voiceConfirm"
      :aria-label="busy ? t.voiceTranscribing : t.voiceConfirm"
      @mousedown.prevent="emit('confirm')"
    >
      <NIcon :component="CheckmarkOutline" :size="15" />
    </button>
  </div>
</template>

<style scoped>
.voice-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0;
  box-sizing: border-box;
  --voice-wave: #9aa0a6;
}

.wave {
  display: block;
  flex: 1;
  min-width: 120px;
  height: 20px;
  width: 100%;
}

.time {
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 500;
  color: #9aa0a6;
  min-width: 2.3em;
  text-align: right;
  user-select: none;
  flex-shrink: 0;
  line-height: 1;
}

.icon-btn {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #9aa0a6;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}

.icon-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: #5f6368;
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.icon-btn.confirm {
  color: #5f6368;
}

.stop-btn {
  width: 20px;
  height: 20px;
  border: 1px solid color-mix(in srgb, #9aa0a6 75%, transparent);
  color: #5f6368;
}

.stop-btn:hover:not(:disabled) {
  border-color: #5f6368;
  background: rgba(0, 0, 0, 0.04);
}

.stop-square {
  display: block;
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: currentColor;
}

:root.dark .voice-bar,
.dark .voice-bar {
  --voice-wave: #9aa0a6;
}

:root.dark .icon-btn:hover:not(:disabled),
.dark .icon-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #dadce0;
}

:root.dark .stop-btn,
.dark .stop-btn {
  border-color: #9aa0a6;
  color: #dadce0;
}

.live.starting {
  color: var(--warning, #f0a020);
}
.live.starting .live-dot {
  background: var(--warning, #f0a020);
}
.live {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--success, #18a058);
  margin-left: 8px;
  user-select: none;
  white-space: nowrap;
}
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success, #18a058);
  animation: voice-live-pulse 1.2s ease-in-out infinite;
}
@keyframes voice-live-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.8); }
}
</style>
