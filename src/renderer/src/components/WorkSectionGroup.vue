<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import { CheckmarkOutline, ChevronForwardOutline } from "@vicons/ionicons5";
import type { ChatMessage } from "@renderer/stores/chat";
import ToolCallCard from "@renderer/components/ToolCallCard.vue";
import { toolCardFor, type ToolCard } from "@renderer/utils/tool-diff";
import {
  categorizeToolCall,
  workSectionCountSummary,
  workSectionLiveTitle,
  type WorkSectionTool,
} from "@renderer/utils/tool-group";
import { t } from "@renderer/i18n";

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

const props = defineProps<{
  /** Process rows in order: tool calls mixed with thinking-only notes. */
  items: ChatMessage[];
  /** True once the next output appeared after this section: fold + summary title. */
  autoCollapse?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
  /** Fired once a fold/unfold settled, so the virtual list can re-measure. */
  resize: [];
}>();

const manuallyOpen = ref<boolean | null>(null);
/** Animate folds only after first paint — matches Copilot (transition after mount). */
const animated = ref(false);
let animationRaf = 0;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const prefersReducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fold/unfold animates grid-rows, which re-layouts the whole expanded subtree
 * on every frame. When the section holds huge tool outputs (each diff/output
 * line becomes a DOM node), that freezes the UI thread, so oversized sections
 * skip the animation and snap instead.
 */
const HEAVY_SECTION_CHARS = 60_000;

const heavySection = computed(() => {
  let chars = 0;
  for (const msg of props.items) {
    if (msg.role === "tool") {
      const card = toolCard(msg);
      if (
        card.kind === "bash" ||
        card.kind === "read" ||
        card.kind === "generic"
      ) {
        chars += card.preview?.length ?? 0;
      } else if (
        card.kind === "edit" ||
        card.kind === "write" ||
        card.kind === "other"
      ) {
        chars += card.diff?.length ?? 0;
      }
    } else if (msg.role === "assistant" && msg.thinking) {
      chars += msg.thinking.length;
    }
    if (chars > HEAVY_SECTION_CHARS) return true;
  }
  return false;
});

/** Inner content box — ResizeObserver reports real height changes to the list. */
const bodyRef = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;
let lastReportedHeight = 0;
let reportRaf = 0;
/** Suppress observer reports while a fold/unfold transition is running. */
let transitioning = false;

function scheduleResize(delayMs: number): void {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    transitioning = false;
    emit("resize");
  }, delayMs);
}

function reportHeightNow(): void {
  if (reportRaf) return;
  reportRaf = requestAnimationFrame(() => {
    reportRaf = 0;
    if (transitioning) return;
    emit("resize");
  });
}

watch(bodyRef, (el) => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(() => {
    if (transitioning) return;
    const h = el.scrollHeight;
    if (Math.abs(h - lastReportedHeight) > 1) {
      lastReportedHeight = h;
      reportHeightNow();
    }
  });
  resizeObserver.observe(el);
});

const anyStreaming = computed(() =>
  props.items.some((m) => "streaming" in m && Boolean(m.streaming)),
);
const anyError = computed(() =>
  props.items.some((m) => m.role === "tool" && m.isError && !m.streaming),
);

const open = computed(() => {
  // Next output appeared: only a user-expanded section stays open.
  if (props.autoCollapse) return manuallyOpen.value === true;
  if (manuallyOpen.value !== null) return manuallyOpen.value;
  // Live: stay expanded so each step streams in line by line (Copilot
  // CollapsedPreview keeps the section open while streaming).
  return true;
});

// Copilot folds the block as soon as the next output shows up (the answer
// text or the next work section), not when the whole turn finishes. We delay
// the fold slightly so the newly appearing output is visible first, then the
// earlier block rolls up — no snap on the first token of the next output.
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.autoCollapse,
  (v, prev) => {
    if (!v || prev) return;
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      collapseTimer = null;
      manuallyOpen.value = false;
    }, 350);
  },
);

watch(
  () => props.items.length,
  (len, prev) => {
    if (len > (prev ?? 0) && !props.autoCollapse && manuallyOpen.value === false) {
      // A new step arrived while we were about to auto-fold — abort the fold.
      if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
      }
      manuallyOpen.value = null;
    }
  },
);

watch(
  () => open.value,
  (nowOpen, wasOpen) => {
    if (nowOpen === wasOpen) return;
    transitioning = true;
    // Oversized sections snap instantly: animating grid-rows would re-layout
    // tens of thousands of DOM nodes every frame and freeze the UI thread.
    if (heavySection.value) {
      animated.value = false;
      scheduleResize(0);
      return;
    }
    animationRaf = requestAnimationFrame(() => {
      animated.value = true;
    });
    // Let the CSS grid-rows transition run, then tell the list the height moved.
    scheduleResize(prefersReducedMotion ? 0 : 200);
  },
);

function toggle(): void {
  manuallyOpen.value = !open.value;
}

onBeforeUnmount(() => {
  if (animationRaf) cancelAnimationFrame(animationRaf);
  if (resizeTimer) clearTimeout(resizeTimer);
  if (reportRaf) cancelAnimationFrame(reportRaf);
  if (collapseTimer) clearTimeout(collapseTimer);
  resizeObserver?.disconnect();
  resizeObserver = null;
  liveThinkingEls.clear();
});

function isToolMessage(msg: ChatMessage): msg is ToolMessage {
  return msg.role === "tool";
}

/** The live thinking row inside this section (streams into its 200px box). */
const liveThinkingId = computed<string | null>(() => {
  for (let i = props.items.length - 1; i >= 0; i--) {
    const m = props.items[i]!;
    if (m.role === "assistant" && m.streaming && m.thinking) return m.id;
  }
  return null;
});

/** Follow newest thinking unless the user scrolls up inside the box (ThinkingBlock rule). */
const liveThinkingEls = new Map<string, HTMLElement>();
let thinkingStick = true;
const THINKING_NEAR_BOTTOM_PX = 48;

function refThinkingText(msg: ChatMessage): ((el: unknown) => void) | undefined {
  if (!(msg.role === "assistant" && msg.streaming && msg.thinking)) return undefined;
  return (el) => {
    if (el instanceof HTMLElement) liveThinkingEls.set(msg.id, el);
    else liveThinkingEls.delete(msg.id);
  };
}

function onThinkingScroll(id: string): void {
  const el = liveThinkingEls.get(id);
  if (!el) return;
  thinkingStick =
    el.scrollHeight - el.scrollTop - el.clientHeight < THINKING_NEAR_BOTTOM_PX;
}

async function followLiveThinking(): Promise<void> {
  const id = liveThinkingId.value;
  if (!id || !thinkingStick || !open.value) return;
  await nextTick();
  const el = liveThinkingEls.get(id);
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

watch(liveThinkingId, () => {
  thinkingStick = true;
  void followLiveThinking();
});

watch(
  () => {
    const id = liveThinkingId.value;
    if (!id) return 0;
    for (const m of props.items) {
      if (m.id === id && m.role === "assistant") return m.thinking?.length ?? 0;
    }
    return 0;
  },
  () => {
    void followLiveThinking();
  },
);

watch(
  () => [open.value, props.items.length] as const,
  () => {
    void followLiveThinking();
  },
);

const toolItems = computed(() => props.items.filter(isToolMessage));
const thinkingCount = computed(() => props.items.length - toolItems.value.length);

const categorized = computed(() =>
  toolItems.value.map((m) => categorizeToolCall(m.toolName, m.args)),
);

/** Present-tense label of ONE tool call (copilot streaming header, per step). */
function liveLabelFor(tool: WorkSectionTool): string {
  return workSectionLiveTitle([tool], {
    edit: t.wsLiveEdit,
    read: t.wsLiveRead,
    bash: t.wsLiveBash,
    todo: t.wsLiveTodo,
    tool: t.wsLiveTool,
    thinking: t.wsLiveThinking,
  });
}

/** Cap so a wide fan-out cannot push the header past its single line. */
const MAX_LIVE_LABELS = 4;

/**
 * Live title: every tool call that is still running, shown while streaming.
 *
 * The same step later folds into the section summary — this is only so the user
 * can see what is happening RIGHT NOW, including several operations running at
 * once (each one gets its own segment, capped at MAX_LIVE_LABELS).
 */
const liveTitle = computed(() => {
  const active: WorkSectionTool[] = [];
  for (const msg of props.items) {
    if (msg.role !== "tool" || !msg.streaming) continue;
    active.push(categorizeToolCall(msg.toolName, msg.args));
  }
  // Nothing marked streaming yet (between steps / thinking only): same fallback.
  if (!active.length) return t.wsLiveThinking;

  const labels: string[] = [];
  const seen = new Set<string>();
  for (const tool of active) {
    const label = liveLabelFor(tool);
    // Two identical operations (e.g. three reads of the same file) collapse to
    // one segment rather than "读取 a.ts · 读取 a.ts".
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length >= MAX_LIVE_LABELS) break;
  }
  // Trailing "+N" when the cap hides work, so the header never under-reports.
  const hidden = Math.max(0, active.length - labels.length);
  return labels.join(" · ") + (hidden > 0 ? ` · +${hidden}` : "");
});

/** Settled title: past-tense natural-language summary (Copilot finalized header). */
const summaryTitle = computed(() =>
  workSectionCountSummary(categorized.value, thinkingCount.value, {
    editOne: t.wsSummaryEditOne,
    editMany: t.wsSummaryEditMany,
    readOne: t.wsSummaryReadOne,
    readMany: t.wsSummaryReadMany,
    readAndEdited: t.wsSummaryReadEdited,
    steps: t.wsSummarySteps,
    editCount: t.wsSummaryEditCount,
    readCount: t.wsSummaryReadCount,
    bashCount: t.wsSummaryBashCount,
    todoCount: t.wsSummaryTodoCount,
    toolCount: t.wsSummaryToolCount,
  }),
);

/** Copilot aggregated diff pill: sums diff stats of every edit in the section. */
const diffTotals = computed(() => {
  let added = 0;
  let removed = 0;
  for (const msg of toolItems.value) {
    const card = toolCard(msg);
    if (card.kind === "edit" || card.kind === "write" || card.kind === "other") {
      if (card.stats) {
        added += card.stats.additions;
        removed += card.stats.deletions;
      }
    }
  }
  return { added, removed };
});
const hasDiff = computed(
  () => diffTotals.value.added > 0 || diffTotals.value.removed > 0,
);

const settled = computed(() => props.autoCollapse || !anyStreaming.value);
const title = computed(() => (settled.value ? summaryTitle.value : liveTitle.value));

/** Shared memoized card parsing per message object (tool-diff.ts). */
function toolCard(msg: ToolMessage): ToolCard {
  return toolCardFor(msg);
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
      <span
        v-if="settled && hasDiff"
        class="diff-pill"
        :title="t.wsViewChanges"
      >
        <span class="label-added">+{{ diffTotals.added }}</span>
        <span class="label-removed">-{{ diffTotals.removed }}</span>
      </span>
      <NIcon
        class="hover-chev"
        :class="{ expanded: open }"
        :component="ChevronForwardOutline"
        :size="12"
        aria-hidden="true"
      />
    </button>

    <div
      class="work-section-animation"
      :class="{ collapsed: !open, animated }"
      :aria-hidden="!open ? 'true' : undefined"
    >
      <div class="work-section-animation-inner" ref="bodyRef" :class="{ 'force-hidden': heavySection && !open }">
        <div class="work-section-body">
          <template v-for="msg in items" :key="msg.id">
            <div v-if="isToolMessage(msg)" class="cot-item">
              <ToolCallCard
                :card="toolCard(msg)"
                :tool-name="msg.toolName"
                :order="msg.order"
                :status-label="toolStatus(msg).label"
                :status-type="toolStatus(msg).type"
                :streaming="msg.streaming"
                :auto-collapse="props.autoCollapse"
                tree-item
                detail-collapsed
                @open="emit('open', $event)"
              />
            </div>
            <div v-else-if="msg.role === 'assistant' && msg.thinking" class="cot-item thinking-item">
              <span class="thinking-dot" aria-hidden="true" />
              <div
                class="thinking-text"
                :ref="refThinkingText(msg)"
                @scroll="onThinkingScroll(msg.id)"
              >{{ msg.thinking }}</div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 1:1 VS Code Copilot work section — chatThinkingContentPart + chatCollapsibleContentPart */
.work-section {
  margin: 0 0 2px;
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

/* Aggregated diff pill next to the finalized title (.chat-thinking-title-diff 1:1) */
.diff-pill {
  flex-shrink: 0;
  display: inline-flex;
  gap: 4px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.diff-pill .label-added {
  color: var(--diff-added, var(--success, #2ea043));
}

.diff-pill .label-removed {
  color: var(--diff-removed, var(--error, #d03050));
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

/* Copilot collapsible content animation (chatCollapsibleContentPart.css 1:1):
   keeps the section's DOM mounted and animates height via grid rows, so the
   virtual list never sees an abrupt unmount/remount jump. */
.work-section-animation {
  display: grid;
  grid-template-rows: 1fr;
  opacity: 1;
  visibility: visible;
}

.work-section-animation-inner {
  min-height: 0;
  overflow: hidden;
  /* Keep the fold animation's per-frame relayout inside this subtree so it
     never invalidates (and re-layouts) the whole virtual message list. */
  contain: layout;
}

/* Oversized sections drop the (still-mounted) content from layout entirely
   once folded — thousands of hidden output lines would otherwise keep the
   render tree busy on every scroll / window adjustment. */
.work-section-animation-inner.force-hidden {
  display: none;
}

.work-section-animation.collapsed {
  grid-template-rows: 0fr;
  opacity: 0;
  visibility: hidden;
}

.work-section-animation.animated {
  transition:
    grid-template-rows 180ms cubic-bezier(0.2, 0, 0, 1),
    opacity 140ms cubic-bezier(0.2, 0, 0, 1),
    visibility 0s;
}

.work-section-animation.animated.collapsed {
  transition:
    grid-template-rows 180ms cubic-bezier(0.2, 0, 0, 1),
    opacity 140ms cubic-bezier(0.2, 0, 0, 1),
    visibility 0s linear 180ms;
}

@media (prefers-reduced-motion: reduce) {
  .work-section-animation {
    transition: none !important;
  }
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
