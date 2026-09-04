<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { ChevronForwardOutline } from "@vicons/ionicons5";
import type { ChatMessage } from "@renderer/stores/chat";
import ToolCallCard from "@renderer/components/ToolCallCard.vue";
import { parseToolCard, type ToolCard } from "@renderer/utils/tool-diff";
import { t } from "@renderer/i18n";

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

const props = defineProps<{
  tools: ToolMessage[];
  /** True once the whole turn finished: fold the finished group. */
  autoCollapse?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

const manuallyOpen = ref(false);

const anyStreaming = computed(() => props.tools.some((m) => m.streaming));
const anyError = computed(() => props.tools.some((m) => m.isError && !m.streaming));

/**
 * Streaming: label-only (shimmer) — no live tool dump.
 * Finished: collapsed by default; user can expand cards.
 */
const open = computed(() => {
  if (anyStreaming.value) return false;
  if (props.autoCollapse && !manuallyOpen.value) return false;
  return manuallyOpen.value;
});

watch(anyStreaming, (streaming) => {
  if (streaming) manuallyOpen.value = false;
});

watch(
  () => props.autoCollapse,
  (v) => {
    if (v) manuallyOpen.value = false;
  },
);

function toggle(): void {
  if (anyStreaming.value) return;
  manuallyOpen.value = !manuallyOpen.value;
}

const titleLabel = computed(() => {
  if (anyStreaming.value) {
    const live = props.tools.find((m) => m.streaming)?.toolName;
    return live ? t.toolsRunningHint(live) : t.toolsRunning;
  }
  return t.toolsCalledCount(props.tools.length);
});

const namesHint = computed(() => {
  if (anyStreaming.value) return "";
  const names = props.tools.map((m) => m.toolName).filter(Boolean);
  const unique = [...new Set(names)];
  if (unique.length === 0) return "";
  const shown = unique.slice(0, 4);
  return shown.join(", ") + (unique.length > shown.length ? "…" : "");
});

const statusType = computed<"info" | "error" | "success">(() => {
  if (anyStreaming.value) return "info";
  if (anyError.value) return "error";
  return "success";
});

/** Memoize card parsing per message object (see MessageList.vue). */
const toolCardCache = new WeakMap<ToolMessage, ToolCard>();
function toolCard(msg: ToolMessage): ToolCard {
  let card = toolCardCache.get(msg);
  if (!card) {
    card = parseToolCard(msg.toolName, msg.args, msg.result, { isError: msg.isError });
    toolCardCache.set(msg, card);
  }
  return card;
}

function toolStatus(msg: ToolMessage): {
  type: "default" | "success" | "error" | "info";
  label: string;
} {
  if (msg.streaming) return { type: "info", label: t.toolRunning };
  if (msg.isError) return { type: "error", label: t.toolError };
  return { type: "success", label: t.toolDone };
}

onBeforeUnmount(() => {
  // no timers
});
</script>

<template>
  <div
    class="tool-group"
    :class="{ open, streaming: anyStreaming, error: statusType === 'error' }"
  >
    <!-- Streaming: single shimmer line — no chevron / cards / body. -->
    <div v-if="anyStreaming" class="tool-group-head inert">
      <span class="summary chat-shimmer-text">{{ titleLabel }}</span>
    </div>
    <button
      v-else
      type="button"
      class="tool-group-head"
      :aria-expanded="open"
      @click="toggle"
    >
      <NIcon
        class="chev collapse-arrow"
        :component="ChevronForwardOutline"
        :size="14"
      />
      <span
        v-if="statusType === 'success'"
        class="ok-mark"
        aria-hidden="true"
      >✓</span>
      <span v-else-if="statusType === 'error'" class="err-mark" aria-hidden="true">!</span>
      <span class="summary">{{ titleLabel }}</span>
      <span v-if="namesHint" class="names" :title="namesHint">{{ namesHint }}</span>
    </button>

    <div v-if="open" class="tool-group-body">
      <ToolCallCard
        v-for="msg in tools"
        :key="msg.id"
        :card="toolCard(msg)"
        :tool-name="msg.toolName"
        :order="msg.order"
        :status-label="toolStatus(msg).label"
        :status-type="toolStatus(msg).type"
        :streaming="msg.streaming"
        :auto-collapse="props.autoCollapse || !msg.streaming"
        @open="emit('open', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.tool-group {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  overflow: hidden;
  font-family: var(--font-ui, inherit);
}

.tool-group-head {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  width: auto;
  max-width: 100%;
  margin: 0;
  padding: 2px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.tool-group-head.inert {
  cursor: default;
  display: flex;
  width: 100%;
}

.tool-group-head:not(.inert):hover {
  color: var(--fg);
}

.chev {
  flex-shrink: 0;
  opacity: 0.55;
  transition: transform 150ms ease;
}

.tool-group.open .collapse-arrow {
  transform: rotate(90deg);
}

.ok-mark {
  flex-shrink: 0;
  color: var(--green, #22c55e);
  font-size: 11px;
  font-weight: 700;
}

.err-mark {
  flex-shrink: 0;
  color: var(--red, #ef4444);
  font-size: 11px;
  font-weight: 700;
}

.summary {
  flex-shrink: 0;
  font-weight: 500;
  color: inherit;
}

.names {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-faint, var(--fg-muted));
  font-size: 12px;
}

.names::before {
  content: "·";
  margin: 0 6px 0 2px;
  color: color-mix(in srgb, var(--fg-muted) 50%, transparent);
}

.tool-group-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 2px 0 0 17px;
  padding: 0;
  border: none;
}

.tool-group-body :deep(.tool-call) {
  margin: 0;
}
</style>
