<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { NButton, NIcon, useMessage } from "naive-ui";
import {
  CheckmarkCircleOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  CloseCircleOutline,
  DocumentTextOutline,
  CreateOutline,
  EllipseOutline,
  EyeOutline,
  ListOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import type { ToolCard } from "@renderer/utils/tool-diff";
import { t } from "@renderer/i18n";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useSessionsStore } from "@renderer/stores/sessions";
import { ASK_USER_TOOL_NAME } from "../../../shared/ask-user";

const props = defineProps<{
  card: ToolCard;
  toolName: string;
  order?: number;
  statusLabel: string;
  statusType: "default" | "success" | "error" | "info";
  streaming?: boolean;
  /** True once the whole turn finished: fold finished process rows (Codex-like). */
  autoCollapse?: boolean;
}>();

const emit = defineEmits<{
  open: [path: string];
}>();

/** Write / edit / bash / todo expand while live; read stays collapsed by default. */
function shouldAutoExpand(kind: ToolCard["kind"]): boolean {
  switch (kind) {
    case "write":
    case "edit":
    case "bash":
    case "todo":
      return true;
    case "read":
    case "generic":
    case "other":
      return false;
    default: {
      const _never: never = kind;
      return Boolean(_never);
    }
  }
}

/** Expanded while streaming for write/edit/bash; stays open after so diffs are visible. */
const manuallyOpen = ref<boolean | null>(null);
const wasStreaming = ref(false);
const bodyRef = ref<HTMLElement | null>(null);
/** Follow newest lines unless the user scrolls up inside the card. */
let stickToBottom = true;
const NEAR_BOTTOM_PX = 48;
/**
 * How long a finished tool stays expanded before it folds back into history.
 * The agent usually starts its next step within this window, so the result is
 * visible for a beat, then history collapses (Codex-like).
 */
const AUTO_COLLAPSE_MS = 1200;
let finishTimer: ReturnType<typeof setTimeout> | null = null;

function clearFinishTimer(): void {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
}

const open = computed(() => {
  // Turn finished: only a user-expanded card stays open; history stays folded.
  if (props.autoCollapse) return manuallyOpen.value === true;
  if (manuallyOpen.value !== null) return manuallyOpen.value;
  if (!shouldAutoExpand(props.card.kind)) return false;
  return wasStreaming.value || Boolean(props.streaming);
});

watch(
  () => props.streaming,
  (streaming, prev) => {
    if (!shouldAutoExpand(props.card.kind)) return;
    if (streaming) {
      // Reset manual override while streaming so it tracks live state.
      manuallyOpen.value = null;
      wasStreaming.value = true;
      stickToBottom = true;
      clearFinishTimer();
    } else if (prev && !streaming) {
      // Just finished — keep expanded so the result (diff/output) is visible,
      // then auto-collapse once the agent moves on / shortly after completion.
      wasStreaming.value = true;
      clearFinishTimer();
      finishTimer = setTimeout(() => {
        finishTimer = null;
        // Respect a manual open: only auto-fold cards the user didn't expand.
        if (manuallyOpen.value === null) manuallyOpen.value = false;
      }, AUTO_COLLAPSE_MS);
    }
  },
  { immediate: true },
);

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

function toggleOpen(): void {
  const next = !open.value;
  manuallyOpen.value = next;
  if (!next) return;
  stickToBottom = true;
  void scrollBodyToLatest();
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

const backgroundBusy = ref(false);
const message = useMessage();
const agentRuns = useAgentRunsStore();
const sessions = useSessionsStore();

const isAskUserTool = computed(() => props.toolName === ASK_USER_TOOL_NAME);

const blockingRunId = computed(() => {
  if (props.card.kind !== "bash" || !props.streaming) return null;
  const sessionId = sessions.activeId;
  const command = props.card.command?.trim();
  if (!sessionId || !command) return null;
  return agentRuns.findBlockingRun(sessionId, command)?.id ?? null;
});

const canBackground = computed(() => Boolean(blockingRunId.value));

async function onBackground(): Promise<void> {
  const runId = blockingRunId.value;
  if (!runId || backgroundBusy.value) return;
  backgroundBusy.value = true;
  try {
    await agentRuns.background(runId);
    message.success(t.toolBackgrounded);
  } catch (err) {
    message.error(err instanceof Error ? err.message : t.toolBackgroundFailed);
  } finally {
    backgroundBusy.value = false;
  }
}

const fileName = computed(() => {
  if (props.card.kind === "bash" || props.card.kind === "generic" || props.card.kind === "todo") {
    return null;
  }
  const p = props.card.path;
  if (!p) return null;
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
});

const actionLabel = computed(() => {
  switch (props.card.kind) {
    case "write":
      return t.toolWrite;
    case "edit":
      return t.toolEdit;
    case "read":
      return t.toolRead;
    case "bash":
      return t.toolBash;
    case "todo":
      return t.toolTodo;
    case "generic":
      return isAskUserTool.value ? t.askUserToolLabel : props.toolName;
    case "other":
      return isAskUserTool.value ? t.askUserToolLabel : props.toolName;
    default: {
      const _never: never = props.card;
      return String(_never);
    }
  }
});

const kindIcon = computed(() => {
  switch (props.card.kind) {
    case "read":
      return EyeOutline;
    case "write":
    case "edit":
      return CreateOutline;
    case "bash":
      return TerminalOutline;
    case "todo":
      return ListOutline;
    case "generic":
    case "other":
      return DocumentTextOutline;
    default: {
      const _never: never = props.card;
      return DocumentTextOutline;
    }
  }
});

const metaLine = computed(() => {
  const card = props.card;
  if (card.kind === "read") {
    if (card.linesRead != null && card.totalLines != null) {
      return t.toolLinesRead(card.linesRead, card.totalLines);
    }
    if (card.linesRead != null) return t.toolLinesOf(card.linesRead);
    return null;
  }
  if (card.kind === "bash") {
    if (card.linesRead != null && card.totalLines != null) {
      return t.toolLinesRead(card.linesRead, card.totalLines);
    }
    if (card.linesRead != null) return t.toolLinesOf(card.linesRead);
    return null;
  }
  if (card.kind === "todo" && card.summary) return card.summary;
  return null;
});

const headline = computed(() => {
  if (isAskUserTool.value) return "";
  const card = props.card;
  if (card.kind === "bash") return card.command || props.toolName;
  if (card.kind === "generic") return card.summary || props.toolName;
  if (card.kind === "todo") {
    if (card.action === "add") return t.toolTodoAdd;
    if (card.action === "toggle") return t.toolTodoToggle;
    if (card.action === "clear") return t.toolTodoClear;
    if (card.action === "list") return t.toolTodoList;
    return card.items.length ? t.todoProgress(
      card.items.filter((i) => i.done).length,
      card.items.length,
    ) : props.toolName;
  }
  return fileName.value || props.toolName;
});

const pathHint = computed(() => {
  if (
    props.card.kind === "bash" ||
    props.card.kind === "generic" ||
    props.card.kind === "todo"
  ) {
    return undefined;
  }
  const full = props.card.path;
  if (!full || full === fileName.value) return undefined;
  return full;
});

const body = computed(() => {
  const card = props.card;
  if (card.kind === "todo") return null;
  if (card.kind === "bash") {
    const cmd = card.command?.trim() || "";
    const out = card.preview?.trim() || "";
    if (cmd && out) return `$ ${cmd}\n\n${out}`;
    if (out) return out;
    if (cmd) return `$ ${cmd}`;
    return null;
  }
  if (card.kind === "edit" || card.kind === "write" || card.kind === "other") {
    return card.diff;
  }
  return card.preview;
});

const stickKinds = computed(
  () =>
    props.card.kind === "write" ||
    props.card.kind === "edit" ||
    props.card.kind === "bash",
);

watch(
  () => [body.value, props.streaming, open.value, stickKinds.value] as const,
  () => {
    if (!stickKinds.value) return;
    // Write/edit: always stick while open (args/result land progressively).
    // Bash: stick while streaming live output.
    if (props.card.kind === "bash" && !props.streaming) return;
    void scrollBodyToLatest();
  },
);

const emptyBodyText = computed(() => {
  if (props.card.kind === "bash") return t.toolNoOutput;
  if (props.card.kind === "todo") return t.toolTodoEmpty;
  if (props.card.kind === "read" || props.card.kind === "generic") return t.toolNoOutput;
  return t.toolNoDiff;
});

const isDiffBody = computed(
  () => props.card.kind === "edit" || props.card.kind === "write",
);

const pathTitle = computed(() => {
  if (
    props.card.kind === "bash" ||
    props.card.kind === "generic" ||
    props.card.kind === "todo"
  ) {
    return undefined;
  }
  return props.card.path ?? undefined;
});

const canPreviewPath = computed(() => {
  const card = props.card;
  return (
    (card.kind === "read" ||
      card.kind === "edit" ||
      card.kind === "write" ||
      card.kind === "other") &&
    Boolean(card.path)
  );
});

const todoItems = computed(() =>
  props.card.kind === "todo" ? props.card.items : [],
);

function onOpenPreview(): void {
  const card = props.card;
  if (
    card.kind === "read" ||
    card.kind === "edit" ||
    card.kind === "write" ||
    card.kind === "other"
  ) {
    if (card.path) emit("open", card.path);
  }
}
</script>

<template>
  <div
    class="tool-call"
    :class="{
      streaming: Boolean(streaming),
      error: statusType === 'error',
      open,
      'ask-user-muted': isAskUserTool,
      [`kind-${card.kind}`]: true,
    }"
  >
    <div class="tool-call-head" @click="toggleOpen">
      <button type="button" class="expand-hit" :aria-expanded="open">
        <NIcon
          class="chev"
          :component="open ? ChevronDownOutline : ChevronForwardOutline"
          :size="12"
        />
      </button>
      <NIcon class="kind-icon" :component="kindIcon" :size="14" />
      <span class="action">{{ actionLabel }}</span>
      <span class="headline" :title="pathTitle || headline">{{ headline }}</span>
      <span v-if="pathHint" class="path-hint" :title="pathHint">{{ pathHint }}</span>
      <span v-if="metaLine" class="meta">{{ metaLine }}</span>
      <span
        v-if="(card.kind === 'edit' || card.kind === 'write') && card.stats"
        class="meta stats"
      >
        <span class="add">+{{ card.stats.additions }}</span>
        <span class="del">-{{ card.stats.deletions }}</span>
      </span>
      <span v-if="card.kind === 'read' && card.truncated" class="trunc">{{ t.toolTruncated }}</span>
      <span v-if="card.kind === 'bash' && card.truncated" class="trunc">{{ t.toolTruncated }}</span>
      <span class="status" :class="statusType" :title="statusLabel">
        <span v-if="streaming" class="spinner" aria-hidden="true" />
        <NIcon
          v-else-if="statusType === 'error'"
          :component="CloseCircleOutline"
          :size="14"
        />
        <NIcon
          v-else-if="statusType === 'success' || statusType === 'default'"
          :component="CheckmarkCircleOutline"
          :size="14"
        />
      </span>
      <button
        v-if="canPreviewPath"
        type="button"
        class="open-btn"
        :title="t.previewFile"
        @click.stop="onOpenPreview"
      >
        <NIcon :component="DocumentTextOutline" :size="13" />
      </button>
      <NButton
        v-if="canBackground"
        size="tiny"
        secondary
        class="bg-btn"
        :loading="backgroundBusy"
        :title="t.toolMoveToBackground"
        @click.stop="onBackground"
      >
        {{ t.toolMoveToBackground }}
      </NButton>
    </div>
    <ul v-if="open && card.kind === 'todo' && todoItems.length" class="todo-body">
      <li
        v-for="item in todoItems"
        :key="item.id"
        class="todo-row"
        :class="{ done: item.done }"
      >
        <NIcon
          :component="item.done ? CheckmarkCircleOutline : EllipseOutline"
          :size="14"
          class="todo-mark"
        />
        <span class="todo-text">{{ item.text }}</span>
      </li>
    </ul>
    <pre
      v-else-if="open && body"
      ref="bodyRef"
      class="tool-body"
      :class="{ 'tool-body-bash': card.kind === 'bash' }"
      @scroll="onBodyScroll"
    ><code><span
      v-for="(line, i) in body.split('\n')"
      :key="i"
      class="dline"
      :class="{
        add: isDiffBody && line.startsWith('+') && !line.startsWith('+++'),
        del: isDiffBody && line.startsWith('-') && !line.startsWith('---'),
        meta: isDiffBody && (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')),
      }"
    >{{ line || ' ' }}</span></code></pre>
    <pre v-else-if="open && !body" class="tool-body empty">{{ emptyBodyText }}</pre>
  </div>
</template>

<style scoped>
.tool-call {
  width: 100%;
  /* Cursor-style: no card chrome — plain text row with a fold chevron. */
  overflow: hidden;
  transition: opacity 0.12s ease;
}

.tool-call.streaming {
  /* Slight emphasis while live, no border box. */
  color: var(--fg);
}

.tool-call.error {
  color: var(--error, #d03050);
}

.tool-call.ask-user-muted {
  opacity: 0.82;
}

.tool-call.ask-user-muted .action {
  color: var(--fg-faint, #888);
  font-weight: 500;
}

.tool-call.ask-user-muted .headline:empty {
  display: none;
}

.tool-call-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 3px 4px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.tool-call-head:hover {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
}

.expand-hit {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.chev {
  flex-shrink: 0;
  color: var(--fg-faint, #999);
}

.kind-icon {
  flex-shrink: 0;
  color: var(--fg-muted, #666);
}

.kind-bash .kind-icon {
  color: color-mix(in srgb, var(--primary, #3b82f6) 70%, var(--fg-muted));
}

.kind-read .kind-icon {
  color: #6b7280;
}

.kind-edit .kind-icon,
.kind-write .kind-icon {
  color: #0d9488;
}

.action {
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--fg-muted, #555);
  letter-spacing: 0.01em;
}

.headline {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  color: var(--fg-strong, #1a1a1a);
}

.path-hint {
  display: none;
  flex-shrink: 1;
  min-width: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--fg-faint, #999);
  font-family: var(--font-mono, ui-monospace, monospace);
}

@media (min-width: 720px) {
  .path-hint {
    display: inline;
  }
}

.meta {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.meta.stats {
  display: inline-flex;
  gap: 5px;
  font-family: var(--font-mono, ui-monospace, monospace);
}

.add {
  color: #1a7f37;
}

.del {
  color: #cf222e;
}

.trunc {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--warning, #9a6700);
}

.status {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  color: var(--fg-faint, #999);
}

.status.success,
.status.default {
  color: #1a7f37;
}

.status.error {
  color: #cf222e;
}

.status.info {
  color: var(--primary, #3b82f6);
}

.spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, var(--primary, #3b82f6) 30%, transparent);
  border-top-color: var(--primary, #3b82f6);
  border-radius: 50%;
  animation: tool-spin 0.7s linear infinite;
}

@keyframes tool-spin {
  to {
    transform: rotate(360deg);
  }
}

.open-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
}

.open-btn:hover {
  background: var(--bg-hover, rgba(127, 127, 127, 0.1));
  color: var(--fg-strong);
}

.bg-btn {
  flex-shrink: 0;
}

.tool-body {
  margin: 0;
  padding: 5px 4px;
  border-top: 1px solid color-mix(in srgb, var(--border, #ddd) 35%, transparent);
  max-height: 140px;
  overflow: auto;
  font-size: 11.5px;
  line-height: 1.5;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}

.tool-body.empty {
  padding: 10px 12px;
  color: var(--fg-muted);
}

.tool-body-bash .dline {
  color: var(--fg-strong, #222);
}

.dline {
  display: block;
  padding: 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
}

.dline.add {
  background: rgba(46, 160, 67, 0.12);
}

.dline.del {
  background: rgba(248, 81, 73, 0.12);
}

.dline.meta {
  color: var(--fg-muted);
}

.todo-body {
  list-style: none;
  margin: 0;
  padding: 6px 4px 8px;
  border-top: 1px solid color-mix(in srgb, var(--border, #ddd) 35%, transparent);
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
}

.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  line-height: 1.35;
  color: var(--fg);
}

.todo-row.done {
  color: var(--fg-muted);
}

.todo-row.done .todo-text {
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--fg-muted) 55%, transparent);
}

.todo-mark {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--fg-muted);
}

.todo-row.done .todo-mark {
  color: var(--success, #3d9a6a);
}

.todo-text {
  min-width: 0;
  word-break: break-word;
}
</style>
