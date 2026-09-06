<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NButton, NIcon, useMessage } from "naive-ui";
import {
  CheckmarkCircleOutline,
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
import { previewText } from "@renderer/utils/tool-diff";
import FileChip from "@renderer/components/FileChip.vue";
import { t } from "@renderer/i18n";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useAppearanceStore } from "@renderer/stores/appearance";
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
  /** Rendered as a child of a Copilot tool group: indented under the tree line. */
  treeItem?: boolean;
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
const bodyRef = ref<HTMLElement | null>(null);
/** Follow newest lines unless the user scrolls up inside the card. */
let stickToBottom = true;
const NEAR_BOTTOM_PX = 48;

const open = computed(() => {
  // Turn finished: only a user-expanded card stays open; history stays folded.
  if (props.autoCollapse) return manuallyOpen.value === true;
  if (manuallyOpen.value !== null) return manuallyOpen.value;
  if (!shouldAutoExpand(props.card.kind)) return false;
  // Copilot: a finished step stays open until the whole turn finishes; the
  // result (diff/output) keeps streaming in instead of folding after 1.2s.
  return Boolean(props.streaming);
});

watch(
  () => props.streaming,
  (streaming) => {
    if (streaming) {
      // Reset manual override while streaming so it tracks live state.
      manuallyOpen.value = null;
      stickToBottom = true;
    }
  },
  { immediate: true },
);

// Fold everything as soon as the round finishes; users can re-expand manually.
watch(
  () => props.autoCollapse,
  (v) => {
    if (!v) return;
    manuallyOpen.value = false;
  },
);

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
      return isAskUserTool.value ? t.askUserToolLabel : `${t.toolBash} ${props.toolName}`;
    case "other":
      return isAskUserTool.value ? t.askUserToolLabel : `${t.toolBash} ${props.toolName}`;
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
    default:
      return DocumentTextOutline;
  }
});

const metaLine = computed(() => {
  const card = props.card;
  if (card.kind === "read") {
    if (card.linesRead != null && card.totalLines != null) {
      return t.toolLinesRange(card.linesRead, card.totalLines);
    }
    if (card.linesRead != null) return t.toolLinesCount(card.linesRead);
    return null;
  }
  if (card.kind === "bash") {
    if (card.linesRead != null && card.totalLines != null) {
      return t.toolLinesRange(card.linesRead, card.totalLines);
    }
    if (card.linesRead != null) return t.toolLinesCount(card.linesRead);
    return null;
  }
  if (card.kind === "todo" && card.summary) return card.summary;
  return null;
});

const headline = computed(() => {
  if (isAskUserTool.value) return "";
  const card = props.card;
  if (card.kind === "bash") return card.command || props.toolName;
  if (card.kind === "generic") return card.summary || "";
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

const appearance = useAppearanceStore();

/** Full stored text, or the 24-line cut when Settings → General opts into it. */
function renderBodyText(text: string | null | undefined): string | null {
  if (!text) return null;
  return appearance.truncateToolOutput ? previewText(text) : text;
}

const body = computed(() => {
  const card = props.card;
  if (card.kind === "todo") return null;
  if (card.kind === "bash") {
    const cmd = card.command?.trim() || "";
    const out = renderBodyText(card.preview);
    if (cmd && out) return `$ ${cmd}\n\n${out}`;
    if (out) return out;
    if (cmd) return `$ ${cmd}`;
    return null;
  }
  if (card.kind === "edit" || card.kind === "write") {
    return card.diff;
  }
  if (card.kind === "other") return renderBodyText(card.diff);
  return card.kind === "read" || card.kind === "generic"
    ? renderBodyText(card.preview)
    : null;
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

/** Rows with nothing to reveal drop the disclosure affordance (VS Code setExpandable). */
const expandable = computed(() => {
  if (props.card.kind === "todo") return todoItems.value.length > 0;
  return Boolean(body.value);
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
</script>

<template>
  <div
    class="tool-call"
    :class="{
      streaming: Boolean(streaming),
      error: statusType === 'error',
      open,
      'tree-item': treeItem,
      'not-expandable': !expandable,
      'ask-user-muted': isAskUserTool,
      [`kind-${card.kind}`]: true,
    }"
  >
    <div class="tool-call-head" :title="pathTitle" @click="expandable && toggleOpen()">
      <span class="kind-icon" :class="{ error: statusType === 'error' }" aria-hidden="true">
        <NIcon
          :component="statusType === 'error' ? CloseCircleOutline : kindIcon"
          :size="12"
        />
      </span>
      <span class="head-text">
        <span class="action" :class="{ 'copilot-shimmer': Boolean(streaming) }">{{ actionLabel }}</span>
        <FileChip
          v-if="canPreviewPath && card.path"
          :path="card.path"
          @open="emit('open', $event)"
        />
        <code v-else-if="card.kind === 'bash' && card.command" class="cmd-pill">{{
          card.command
        }}</code>
        <span v-else class="headline" :class="{ 'copilot-shimmer': Boolean(streaming) }">{{ headline }}</span>
        <span v-if="metaLine" class="meta">{{ metaLine }}</span>
        <span
          v-if="(card.kind === 'edit' || card.kind === 'write') && card.stats"
          class="meta stats"
        >
          <span class="add">+{{ card.stats.additions }}</span>
          <span class="del">-{{ card.stats.deletions }}</span>
        </span>
        <span v-if="(card.kind === 'read' || card.kind === 'bash') && card.truncated" class="trunc">{{
          t.toolTruncated
        }}</span>
      </span>
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
      <NIcon
        v-if="expandable"
        class="hover-chev"
        :class="{ expanded: open }"
        :component="ChevronForwardOutline"
        :size="12"
        aria-hidden="true"
      />
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
/* 1:1 VS Code Copilot tool row — see chatProgressContentPart / chatThinkingContent.css */
.tool-call {
  width: 100%;
  overflow: hidden;
  font-size: var(--chat-font-s, 12px);
  line-height: 1.5em;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.tool-call.error {
  color: var(--error, #d03050);
}

.tool-call.ask-user-muted {
  opacity: 0.82;
}

.tool-call.ask-user-muted .headline:empty {
  display: none;
}

.tool-call-head {
  position: relative;
  width: fit-content;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 2px 6px 2px 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
}

.tool-call.not-expandable .tool-call-head {
  cursor: default;
}

.tool-call-head:hover {
  background: var(--chat-hover-bg, color-mix(in srgb, var(--fg) 5%, transparent));
  color: var(--fg, inherit);
}

/* Tree mode (inside WorkSectionGroup): icon hangs on the chain-of-thought line. */
.tool-call.tree-item .tool-call-head {
  width: 100%;
  padding: 4px 12px 4px 24px;
}

.kind-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--chat-icon-fg, var(--fg-muted));
}

.kind-icon.error {
  color: var(--error, #d03050);
}

.tool-call.tree-item .kind-icon {
  position: absolute;
  left: 5px;
  top: 8px;
}

.head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.action {
  font: inherit;
  color: inherit;
  flex-shrink: 0;
}

.headline {
  font: inherit;
  color: inherit;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* bash command / glob pattern pill — VS Code [data-code] inside progress text */
.cmd-pill {
  display: inline-block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  margin: 0;
  padding: 1px 3px;
  border: 1px solid var(--chat-line, var(--border));
  border-radius: 4px;
  background: var(--md-inline-code-bg, var(--code-bg));
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: var(--chat-font-xs, 11px);
  color: inherit;
  white-space: nowrap;
}

/* Long commands/headlines shrink themselves; the line-count meta always stays visible. */
.meta {
  font: inherit;
  color: inherit;
  opacity: 0.85;
  flex-shrink: 0;
}

.meta.stats {
  display: inline-flex;
  gap: 5px;
  margin-left: 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  opacity: 1;
  flex-shrink: 0;
}

.head-text .file-chip {
  min-width: 0;
}

.add {
  color: var(--git-u, #1a7f37);
}

.del {
  color: var(--git-d, #cf222e);
}

.trunc {
  margin-left: 0;
  flex-shrink: 0;
  font-size: var(--chat-font-xs, 11px);
  color: var(--warning, #9a6700);
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

.tool-call-head:hover .hover-chev {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .hover-chev {
    transition: none;
  }
}

.bg-btn {
  flex-shrink: 0;
}

.tool-body {
  margin: 2px 0 4px;
  padding: 5px 8px;
  max-height: 160px;
  overflow: auto;
  font-size: var(--chat-font-xs, 11px);
  line-height: 1.5;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  border: 1px solid var(--chat-line, var(--border));
  border-radius: 6px;
  background: var(--pre-bg, var(--code-bg));
  color: var(--fg, inherit);
}

.tool-call.tree-item .tool-body {
  margin-left: 24px;
}

.tool-body.empty {
  padding: 8px 10px;
  color: var(--chat-desc-fg, var(--fg-muted));
}

.tool-body-bash .dline {
  color: var(--fg-strong, inherit);
}

.dline {
  display: block;
  padding: 0 4px;
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
  margin: 2px 0 4px;
  padding: 6px 8px;
  border: 1px solid var(--chat-line, var(--border));
  border-radius: 6px;
  background: var(--pre-bg, var(--code-bg));
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow: auto;
}

.tool-call.tree-item .todo-body {
  margin-left: 24px;
}

.todo-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--chat-font-s, 12px);
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
