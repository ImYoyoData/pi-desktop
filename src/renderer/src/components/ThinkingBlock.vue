<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { ChevronForwardOutline } from "@vicons/ionicons5";
import { t } from "@renderer/i18n";

const props = defineProps<{
  thinking: string;
  /** True while the model is still producing thinking (before answer text). */
  streaming?: boolean;
  /** True once the whole turn finished: fold finished thinking (Codex-like). */
  autoCollapse?: boolean;
}>();

/**
 * History rows stay collapsed (cheap open). Live streaming auto-expands;
 * once the whole turn finishes the block folds back up (Codex-like), unless
 * the user expanded it manually.
 */
const manuallyOpen = ref<boolean | null>(null);
const open = computed(() => {
  // Turn finished: only a user-expanded block stays open; history stays folded.
  if (props.autoCollapse) return manuallyOpen.value === true;
  if (manuallyOpen.value !== null) return manuallyOpen.value;
  return Boolean(props.streaming);
});
const bodyRef = ref<HTMLElement | null>(null);
/** Follow newest text unless the user scrolls up inside the card. */
let stickToBottom = true;
const NEAR_BOTTOM_PX = 48;

const headLabel = computed(() =>
  props.streaming ? t.thinkingStreaming : t.thinking,
);

/** 流式长思考只挂载尾部窗口，防止整段文本常驻 DOM、每 tick 全量布局。 */
const THINK_LIVE_MAX_CHARS = 16_000;
const displayThinking = computed(() => {
  const text = props.thinking;
  if (!props.streaming || text.length <= THINK_LIVE_MAX_CHARS) return text;
  return `…\n${text.slice(-THINK_LIVE_MAX_CHARS)}`;
});

watch(
  () => props.streaming,
  (streaming) => {
    if (streaming) {
      // Let the computed track live state (auto-expands when the turn is open).
      manuallyOpen.value = null;
      stickToBottom = true;
    }
  },
);

// Fold everything as soon as the round finishes; users can re-expand manually.
watch(
  () => props.autoCollapse,
  (v) => {
    if (v) manuallyOpen.value = false;
  },
);

function toggleOpen(): void {
  manuallyOpen.value = !open.value;
}

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
  () => [props.thinking, props.streaming, open.value] as const,
  () => {
    if (!props.streaming) return;
    void scrollBodyToLatest();
  },
);
</script>

<template>
  <div class="thinking" :class="{ streaming: Boolean(streaming), open }">
    <button type="button" class="thinking-head" @click="toggleOpen">
      <span class="label" :class="{ 'copilot-shimmer': Boolean(streaming) }">{{ headLabel }}</span>
      <NIcon
        class="hover-chev"
        :class="{ expanded: open }"
        :component="ChevronForwardOutline"
        :size="12"
        aria-hidden="true"
      />
    </button>
    <div
      v-if="open && thinking"
      ref="bodyRef"
      class="thinking-body"
      @scroll="onBodyScroll"
    >{{ displayThinking }}</div>
    <div v-else-if="open && streaming && !thinking" class="thinking-body muted">
      {{ headLabel }}
    </div>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot thinking row — chatThinkingContent.css / chatCollapsibleContentPart */
.thinking {
  margin: 0 0 2px;
  overflow: hidden;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.thinking-head {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: fit-content;
  max-width: 100%;
  margin: 0 0 0 -2px;
  padding: 2px 6px 2px 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.5em;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.thinking-head:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
  color: var(--fg, inherit);
}

.thinking.open > .thinking-head {
  color: var(--fg, inherit);
}

.label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Trailing disclosure chevron — .chat-collapsible-hover-chevron (1:1) */
.hover-chev {
  flex-shrink: 0;
  opacity: 0;
  transform: rotate(0deg);
  transform-origin: center;
  transition:
    opacity 100ms ease-in-out,
    transform 180ms cubic-bezier(0.2, 0, 0, 1);
  color: var(--chat-desc-fg, var(--fg-muted));
}

.hover-chev.expanded {
  opacity: 1;
  transform: rotate(90deg);
}

.thinking-head:hover .hover-chev {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .hover-chev {
    transition: none;
  }
}

.thinking-body {
  margin: 2px 0 6px 10.5px;
  padding: 2px 0 2px 13px;
  border-left: 1px solid var(--chat-line, var(--border));
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.5em;
  color: var(--chat-desc-fg, var(--fg-muted));
  user-select: text;
  -webkit-user-select: text;
}

.thinking-body.muted {
  opacity: 0.75;
}
</style>
