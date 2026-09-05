<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { CheckmarkOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import type { ChatMessage } from "@renderer/stores/chat";
import ToolCallCard from "@renderer/components/ToolCallCard.vue";
import { parseToolCard, type ToolCard } from "@renderer/utils/tool-diff";
import {
  categorizeToolCall,
  summarizeWorkSection,
  workSectionLiveTitle,
  type WorkSectionTool,
} from "@renderer/utils/tool-group";
import { t } from "@renderer/i18n";

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

const props = defineProps<{
  /** Process rows in order: tool calls mixed with thinking-only notes. */
  items: ChatMessage[];
  /** True once the section settled (or the whole turn finished): fold + summary title. */
  autoCollapse?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

const manuallyOpen = ref<boolean | null>(null);
const wasStreaming = ref(false);

const anyStreaming = computed(() => props.items.some((m) => m.streaming));
const anyError = computed(() =>
  props.items.some((m) => m.role === "tool" && m.isError && !m.streaming),
);
/** Collapse the finished section shortly after it stops streaming. */
const AUTO_COLLAPSE_MS = 1200;
let finishTimer: ReturnType<typeof setTimeout> | null = null;

function clearFinishTimer(): void {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
}

const open = computed(() => {
  // Section settled: only a user-expanded section stays open.
  if (props.autoCollapse) return manuallyOpen.value === true;
  if (manuallyOpen.value !== null) return manuallyOpen.value;
  // While steps are running (and just after), keep expanded so the latest step is visible.
  return wasStreaming.value || anyStreaming.value;
});

watch(anyStreaming, (streaming, prev) => {
  if (streaming) {
    manuallyOpen.value = null;
    wasStreaming.value = true;
    clearFinishTimer();
  } else if (prev && !streaming) {
    wasStreaming.value = true;
    clearFinishTimer();
    finishTimer = setTimeout(() => {
      finishTimer = null;
      if (manuallyOpen.value === null) manuallyOpen.value = false;
    }, AUTO_COLLAPSE_MS);
  }
});

// Fold as soon as the round finishes; users can re-expand manually.
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

function isToolMessage(msg: ChatMessage): msg is ToolMessage {
  return msg.role === "tool";
}

const toolItems = computed(() => props.items.filter(isToolMessage));
const thinkingCount = computed(() => props.items.length - toolItems.value.length);

const categorized = computed(() =>
  toolItems.value.map((m) => categorizeToolCall(m.toolName, m.args)),
);

/** Live title: present-tense label of the latest step (Copilot streaming header). */
const liveTitle = computed(() => {
  const last = props.items[props.items.length - 1];
  if (!last) return t.wsLiveThinking;
  if (last.role !== "tool") return t.wsLiveThinking;
  const tools: WorkSectionTool[] = [categorizeToolCall(last.toolName, last.args)];
  return workSectionLiveTitle(tools, {
    edit: t.wsLiveEdit,
    read: t.wsLiveRead,
    bash: t.wsLiveBash,
    todo: t.wsLiveTodo,
    tool: t.wsLiveTool,
    thinking: t.wsLiveThinking,
  });
});

/** Settled title: past-tense natural-language summary (Copilot finalized header). */
const summaryTitle = computed(() =>
  summarizeWorkSection(categorized.value, thinkingCount.value, {
    editOne: t.wsSummaryEditOne,
    editMany: t.wsSummaryEditMany,
    readOne: t.wsSummaryReadOne,
    readMany: t.wsSummaryReadMany,
    readAndEdited: t.wsSummaryReadEdited,
    bash: t.wsSummaryBash,
    todo: t.wsSummaryTodo,
    tool: t.wsSummaryTool,
    steps: t.wsSummarySteps,
    join: t.wsSummaryJoin,
  }),
);

const settled = computed(() => props.autoCollapse || !anyStreaming.value);
const title = computed(() => (settled.value ? summaryTitle.value : liveTitle.value));

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
    class="work-section"
    :class="{ open, streaming: anyStreaming, error: anyError }"
  >
    <button type="button" class="work-section-head" :aria-expanded="open" @click="toggle">
      <span v-if="!settled" class="live-dot" aria-hidden="true" />
      <NIcon
        v-else
        class="done-icon"
        :component="CheckmarkOutline"
        :size="12"
        aria-hidden="true"
      />
      <span class="summary" :class="{ 'copilot-shimmer': !settled }">{{ title }}</span>
      <NIcon
        class="hover-chev"
        :class="{ expanded: open }"
        :component="ChevronForwardOutline"
        :size="12"
        aria-hidden="true"
      />
    </button>

    <div v-if="open" class="work-section-body">
      <template v-for="msg in items" :key="msg.id">
        <div v-if="isToolMessage(msg)" class="cot-item">
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
        <div v-else-if="msg.role === 'assistant' && msg.thinking" class="cot-item thinking-item">
          <span class="thinking-dot" aria-hidden="true" />
          <div class="thinking-text">{{ msg.thinking }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot work section — chatThinkingContentPart + chatCollapsibleContentPart */
.work-section {
  margin: 0 0 2px;
  overflow: hidden;
}

.work-section-head {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
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

.work-section-head:hover {
  color: var(--fg, inherit);
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
}

.work-section.open > .work-section-head {
  color: var(--fg, inherit);
}

/* Streaming state icon — circle-filled like chatThinkingContentPart */
.live-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin: 0 3px;
  border-radius: 50%;
  background: currentColor;
  animation: ws-pulse 1.6s ease-in-out infinite;
}

.done-icon {
  flex-shrink: 0;
  margin: 0 3px;
  color: var(--chat-icon-fg, var(--fg-muted));
}

@keyframes ws-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .live-dot {
    animation: none;
  }
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

.work-section-head:hover .hover-chev {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .hover-chev {
    transition: none;
  }
}

/* Curved connector from the header to the first tree item (.chat-used-context-label::after) */
.work-section.open > .work-section-head::after {
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

.work-section-body {
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

/* Thinking row inside the section — plain bullet row (chat-thinking-item) */
.thinking-item {
  padding: 4px 12px 4px 24px;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.5em;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.thinking-dot {
  position: absolute;
  left: 7.5px;
  top: 10px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}

.thinking-text {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}
</style>
