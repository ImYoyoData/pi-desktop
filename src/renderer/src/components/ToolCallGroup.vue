<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NIcon } from "naive-ui";
import {
  CheckmarkCircleOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseCircleOutline,
} from "@vicons/ionicons5";
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
</script>

<template>
  <div
    class="tool-group"
    :class="{ open, streaming: anyStreaming, error: statusType === 'error' }"
  >
    <button type="button" class="tool-group-head" :aria-expanded="open" @click="toggle">
      <NIcon
        class="chev"
        :component="open ? ChevronDownOutline : ChevronForwardOutline"
        :size="12"
      />
      <span class="summary">{{ summary }}</span>
      <span class="count">{{ tools.length }}</span>
      <span class="status" :class="statusType" aria-hidden="true">
        <span v-if="anyStreaming" class="spinner" />
        <NIcon
          v-else-if="statusType === 'error'"
          :component="CloseCircleOutline"
          :size="14"
        />
        <NIcon v-else :component="CheckmarkCircleOutline" :size="14" />
      </span>
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
  margin: 2px 0 6px;
  /* Cursor-style: plain text rows, no card chrome. */
  overflow: hidden;
}

.tool-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0;
  padding: 3px 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}

.tool-group-head:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}

.chev {
  flex-shrink: 0;
  opacity: 0.7;
}

.summary {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: inherit;
}

.count {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  opacity: 0.55;
  font-size: 11px;
}

.status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  width: 14px;
  height: 14px;
}

.status.success {
  color: var(--success, #3c9a5f);
}

.status.error {
  color: var(--error, #d94848);
}

.status.info {
  color: var(--fg-muted);
}

.spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid color-mix(in srgb, currentColor 35%, transparent);
  border-top-color: currentColor;
  border-radius: 50%;
  animation: tool-group-spin 0.7s linear infinite;
}

@keyframes tool-group-spin {
  to {
    transform: rotate(360deg);
  }
}

.tool-group-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 0 0 6px;
}

.tool-group-body :deep(.tool-call) {
  margin: 0;
}
</style>
