<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { ChevronDownOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import { t } from "@renderer/i18n";

const props = defineProps<{
  thinking: string;
  /** True while the model is still producing thinking (before answer text). */
  streaming?: boolean;
}>();

/**
 * History rows stay collapsed (cheap open). Live streaming auto-expands;
 * after the turn finishes we leave open so the just-finished thought stays readable.
 */
const open = ref(Boolean(props.streaming));
const bodyRef = ref<HTMLElement | null>(null);
/** Follow newest text unless the user scrolls up inside the card. */
let stickToBottom = true;
const NEAR_BOTTOM_PX = 48;

function onBodyScroll(): void {
  const el = bodyRef.value;
  if (!el) return;
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

async function scrollBodyToLatest(): Promise<void> {
  if (!open.value || !stickToBottom) return;
  await nextTick();
  const el = bodyRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

watch(
  () => props.streaming,
  (streaming) => {
    if (!streaming) return;
    open.value = true;
    stickToBottom = true;
  },
);

watch(
  () => [props.thinking, props.streaming, open.value] as const,
  () => {
    if (!props.streaming) return;
    void scrollBodyToLatest();
  },
);
</script>

<template>
  <div class="thinking" :class="{ streaming: Boolean(streaming) }">
    <button type="button" class="thinking-head" @click="open = !open">
      <NIcon
        class="chev"
        :component="open ? ChevronDownOutline : ChevronForwardOutline"
        :size="12"
      />
      <span class="label">{{ streaming ? t.thinkingStreaming : t.thinking }}</span>
      <span v-if="streaming" class="pulse" aria-hidden="true" />
    </button>
    <div
      v-if="open && thinking"
      ref="bodyRef"
      class="thinking-body"
      @scroll="onBodyScroll"
    >{{ thinking }}</div>
    <div v-else-if="open && streaming && !thinking" class="thinking-body muted">
      {{ t.thinkingStreaming }}
    </div>
  </div>
</template>

<style scoped>
.thinking {
  margin: 0 0 6px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 70%, transparent);
  background: color-mix(in srgb, var(--fg-muted, #888) 3.5%, transparent);
  overflow: hidden;
}

.thinking.streaming {
  border-color: color-mix(in srgb, var(--primary, #3b82f6) 28%, var(--border, #ddd));
}

.thinking-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--fg-muted, #666);
  font-size: 12px;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
}

.thinking-head:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.06));
  color: var(--fg-strong, #222);
}

.chev {
  flex-shrink: 0;
  opacity: 0.7;
}

.label {
  letter-spacing: 0.01em;
}

.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary, #3b82f6);
  animation: think-pulse 1.1s ease-in-out infinite;
}

@keyframes think-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

.thinking-body {
  margin: 0;
  padding: 0 12px 8px 28px;
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-muted, #666);
  font-style: italic;
  user-select: text;
  -webkit-user-select: text;
}

.thinking-body.muted {
  font-style: normal;
  opacity: 0.75;
}
</style>
