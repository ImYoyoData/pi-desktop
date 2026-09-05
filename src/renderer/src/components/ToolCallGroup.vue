<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { ChevronForwardOutline } from "@vicons/ionicons5";
import type { ChatMessage } from "@renderer/stores/chat";
import ToolCallCard from "@renderer/components/ToolCallCard.vue";
import { parseToolCard, type ToolCard } from "@renderer/utils/tool-diff";
import {
  countToolActivities,
  formatToolGroupSummary,
} from "@renderer/utils/tool-group";
import { t } from "@renderer/i18n";

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

const props = defineProps<{
  tools: ToolMessage[];
  /** True once the whole turn finished: fold the finished group (Codex-like). */
  autoCollapse?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

const manuallyOpen = ref<boolean | null>(null);
const wasStreaming = ref(false);

const anyStreaming = computed(() => props.tools.some((m) => m.streaming));
const anyError = computed(() => props.tools.some((m) => m.isError && !m.streaming));
/** Collapse the finished group shortly after it stops streaming (Codex-like). */
const AUTO_COLLAPSE_MS = 1200;
let finishTimer: ReturnType<typeof setTimeout> | null = null;

function clearFinishTimer(): void {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
}

const open = computed(() => {
  // Turn finished: only a user-expanded group stays open; history stays folded.
  if (props.autoCollapse) return manuallyOpen.value === true;
  if (manuallyOpen.value !== null) return manuallyOpen.value;
  // While tools are running (and just after), keep expanded so the latest call is visible.
  return wasStreaming.value || anyStreaming.value;
});

watch(anyStreaming, (streaming, prev) => {
  if (streaming) {
    manuallyOpen.value = null;
    wasStreaming.value = true;
    clearFinishTimer();
  } else if (prev && !streaming) {
    // Just finished — keep expanded so results are visible, then fold
    // the history back up as the agent moves on.
    wasStreaming.value = true;
    clearFinishTimer();
    finishTimer = setTimeout(() => {
      finishTimer = null;
      if (manuallyOpen.value === null) manuallyOpen.value = false;
    }, AUTO_COLLAPSE_MS);
  }
});

// Fold everything as soon as the round finishes; users can re-expand manually.
watch(
  () => props.autoCollapse,
  (v) => {
    if (!v) return;
    clearFinishTimer();
    manuallyOpen.value = false;
  },
);

onBeforeUnmount(clearFinishTimer);

function toggle(): void {
  manuallyOpen.value = !open.value;
}

const summary = computed(() =>
  formatToolGroupSummary(countToolActivities(props.tools), {
    readTimes: t.toolGroupReadTimes,
    toolTimes: t.toolGroupToolTimes,
    join: (parts) => parts.join(t.toolGroupJoin),
  }),
);

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
</script>

<template>
  <div
    class="tool-group"
    :class="{ open, streaming: anyStreaming, error: anyError }"
  >
    <button type="button" class="tool-group-head" :aria-expanded="open" @click="toggle">
      <span class="summary" :class="{ 'copilot-shimmer': anyStreaming }">{{ summary }}</span>
      <NIcon
        class="hover-chev"
        :class="{ expanded: open }"
        :component="ChevronForwardOutline"
        :size="12"
        aria-hidden="true"
      />
    </button>

    <div v-if="open" class="tool-group-body">
      <div v-for="msg in tools" :key="msg.id" class="cot-item">
        <ToolCallCard
          :card="toolCard(msg)"
          :tool-name="msg.toolName"
          :order="msg.order"
          :status-label="toolStatus(msg).label"
          :status-type="toolStatus(msg).type"
          :streaming="msg.streaming"
          :auto-collapse="props.autoCollapse || !msg.streaming"
          tree-item
          @open="emit('open', $event)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot collapsible tool group — chatCollapsibleContentPart + chatThinkingContent.css */
.tool-group {
  margin: 0 0 2px;
  overflow: hidden;
}

.tool-group-head {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  width: fit-content;
  max-width: 100%;
  margin: 0 0 0 -2px;
  padding: 2px 6px 2px 2px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--chat-desc-fg, var(--fg-muted));
  font: inherit;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.5em;
  text-align: left;
  cursor: pointer;
  user-select: none;
}

.tool-group-head:hover {
  color: var(--fg, inherit);
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.tool-group.open > .tool-group-head {
  color: var(--fg, inherit);
}

.summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
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

.tool-group-head:hover .hover-chev {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .hover-chev {
    transition: none;
  }
}

/* Curved connector from the header to the first tree item (.chat-used-context-label::after) */
.tool-group.open > .tool-group-head::after {
  content: "";
  position: absolute;
  left: 3px;
  top: 100%;
  height: 16px;
  width: 5px;
  border-left: 1px solid var(--chat-line, var(--border));
  border-bottom: 1px solid var(--chat-line, var(--border));
  border-bottom-left-radius: 5px;
  pointer-events: none;
}

.tool-group-body {
  display: flex;
  flex-direction: column;
  margin-left: 5px;
}

/* Chain-of-thought tree line per child item (chatThinkingContent.css 1:1) */
.cot-item {
  position: relative;
}

.cot-item::before {
  content: "";
  position: absolute;
  left: 10.5px;
  top: 0;
  bottom: 0;
  width: 1px;
  border-radius: 0;
  background-color: var(--chat-line, var(--border));
  mask-image: linear-gradient(to bottom, #000 0 5px, transparent 5px 25px, #000 24px 100%);
}

.cot-item:first-child::before {
  mask-image: linear-gradient(to bottom, transparent 0 25px, #000 25px 100%);
}

.cot-item:last-child::before {
  mask-image: linear-gradient(to bottom, #000 0 5px, transparent 5px 100%);
}

.cot-item:only-child::before {
  background: none;
  mask-image: none;
}

@media (prefers-reduced-motion: reduce) {
  .cot-item::before {
    mask-image: none;
  }
}
</style>
