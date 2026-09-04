<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { ChevronForwardOutline } from "@vicons/ionicons5";
import { formatElapsedShort } from "@renderer/utils/agent-wait";
import { t } from "@renderer/i18n";

const props = defineProps<{
  thinking: string;
  /** True while the model is still producing thinking (before answer text). */
  streaming?: boolean;
  /** Epoch ms when thinking started (live timer while streaming). */
  startedAt?: number;
  /** Final thinking duration once finished (ms). */
  durationMs?: number;
  /** True once the whole turn finished: fold finished thinking. */
  autoCollapse?: boolean;
}>();

/**
 * Streaming: plain shimmer label only — no rail, chevron, or body (Cursor).
 * Finished: collapsed by default; user can expand.
 */
const manuallyOpen = ref(false);

const open = computed(() => {
  if (props.streaming) return false;
  if (props.autoCollapse && !manuallyOpen.value) return false;
  return manuallyOpen.value;
});

const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

function stopTick(): void {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
}

function startTick(): void {
  stopTick();
  nowMs.value = Date.now();
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 250);
}

const elapsedLabel = computed(() => {
  if (props.streaming && props.startedAt) {
    return formatElapsedShort(Math.max(0, nowMs.value - props.startedAt));
  }
  if (props.durationMs != null && props.durationMs >= 0) {
    return formatElapsedShort(props.durationMs);
  }
  if (props.streaming && !props.startedAt) {
    return formatElapsedShort(0);
  }
  return "";
});

const titleLabel = computed(() =>
  props.streaming ? t.thinkingStreaming : t.thinkingDone,
);

watch(
  () => [props.streaming, props.startedAt] as const,
  ([streaming, startedAt]) => {
    if (streaming) {
      manuallyOpen.value = false;
      if (startedAt) startTick();
      else stopTick();
      return;
    }
    stopTick();
  },
  { immediate: true },
);

watch(
  () => props.autoCollapse,
  (v) => {
    if (v) manuallyOpen.value = false;
  },
);

function toggleOpen(): void {
  if (props.streaming) return;
  if (!props.thinking) return;
  manuallyOpen.value = !manuallyOpen.value;
}

onUnmounted(() => stopTick());
</script>

<template>
  <div class="thinking" :class="{ streaming: Boolean(streaming), open }">
    <!-- Cursor live: ONLY shimmer text — no card / chevron / rail. -->
    <div v-if="streaming" class="thinking-live" aria-live="polite">
      <span class="chat-shimmer-text">{{ titleLabel }}</span>
    </div>
    <button
      v-else
      type="button"
      class="thinking-head"
      :class="{ inert: !thinking }"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <NIcon
        class="chev collapse-arrow"
        :component="ChevronForwardOutline"
        :size="13"
      />
      <span class="label">{{ titleLabel }}</span>
      <template v-if="elapsedLabel">
        <span class="meta">{{ elapsedLabel }}</span>
      </template>
    </button>
    <div v-if="open && thinking" class="thinking-body">
      <div
        v-for="(line, idx) in thinking.split(/\n+/).filter((l) => l.trim())"
        :key="idx"
        class="thought-line"
      >
        {{ line.trim() }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.thinking {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  overflow: hidden;
  font-size: 13px;
}

/* Live thinking: bare shimmer — short like Cursor. */
.thinking-live {
  display: flex;
  align-items: center;
  min-height: 18px;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  font-family: var(--font-ui, inherit);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
}

.thinking-head {
  width: auto;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 2px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--fg-muted, #8b93a7);
  font-family: var(--font-ui, inherit);
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.thinking-head.inert {
  cursor: default;
}

.thinking-head:not(.inert):hover {
  color: var(--fg-strong, #c4cad8);
}

.chev {
  flex-shrink: 0;
  opacity: 0.55;
  color: inherit;
  transition: transform 150ms ease;
}

.thinking.open .collapse-arrow {
  transform: rotate(90deg);
}

.label {
  letter-spacing: 0.01em;
  color: inherit;
}

.meta {
  color: var(--fg-faint, #5c6578);
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.meta::before {
  content: "·";
  margin: 0 5px 0 2px;
  color: color-mix(in srgb, var(--fg-muted) 45%, transparent);
}

/* Expanded thought text — plain indented copy, no card border. */
.thinking-body {
  margin: 4px 0 2px 17px;
  padding: 0;
  max-height: 240px;
  overflow: auto;
  border: none;
  color: var(--fg-muted, #8b93a7);
  font-family: var(--font-ui, inherit);
  font-size: 12.5px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.thought-line {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
