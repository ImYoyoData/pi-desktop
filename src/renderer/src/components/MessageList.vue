<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NIcon,
  NImage,
  NTag,
  NText,
  NTooltip,
  useDialog,
  useMessage,
} from "naive-ui";
import { ArrowUndoOutline, CopyOutline, CreateOutline, RefreshOutline } from "@vicons/ionicons5";
import type { ChatMessage, ChatRetryHint } from "@renderer/stores/chat";
import { useChatStore } from "@renderer/stores/chat";
import { useCheckpointStore } from "@renderer/stores/checkpoint";
import { useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import MarkdownView from "@renderer/components/MarkdownView.vue";
import ThinkingBlock from "@renderer/components/ThinkingBlock.vue";
import ToolCallCard from "@renderer/components/ToolCallCard.vue";
import { parseToolCard } from "@renderer/utils/tool-diff";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { t } from "@renderer/i18n";

const props = defineProps<{
  messages: ChatMessage[];
  streaming: ChatMessage | null;
  running: boolean;
  retryHint?: ChatRetryHint | null;
}>();

const chat = useChatStore();
const checkpoints = useCheckpointStore();
const composer = useComposerStore();
const sendQueue = useSendQueueStore();
const sessions = useSessionsStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const messageApi = useMessage();
const dialog = useDialog();
const scroller = ref<HTMLElement | null>(null);
let lastPinnedUserId: string | null = null;
/** Avoid follow-bottom immediately undoing the sticky pin scroll. */
let suppressFollowBottomUntil = 0;

const displayMessages = computed(() => {
  const list = [...props.messages];
  if (props.streaming) list.push(props.streaming);
  return list;
});

const latestUserMessageId = computed(() => {
  for (let i = displayMessages.value.length - 1; i >= 0; i--) {
    const m = displayMessages.value[i];
    if (m?.role === "user") return m.id;
  }
  return null;
});

const sessionId = computed(() => sessions.activeId);

function isStickyUser(msg: ChatMessage): boolean {
  return msg.role === "user" && msg.id === latestUserMessageId.value;
}

watch(
  () => sessionId.value,
  () => {
    lastPinnedUserId = null;
  },
);

/** Only when a new latest user message appears: scroll that card to the top. */
watch(
  () => latestUserMessageId.value,
  async (id) => {
    if (!id || id === lastPinnedUserId) return;
    lastPinnedUserId = id;
    suppressFollowBottomUntil = Date.now() + 500;
    await nextTick();
    const sc = scroller.value;
    const card = sc?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!sc || !card) return;
    const scRect = sc.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const top = cardRect.top - scRect.top + sc.scrollTop - 6;
    sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  },
);

watch(
  () => [props.messages.length, props.streaming, props.running] as const,
  async ([, streaming, running], prev) => {
    if (Date.now() < suppressFollowBottomUntil) return;
    await nextTick();
    const el = scroller.value;
    if (!el) return;
    const prevStreaming = prev?.[1] ?? null;
    const prevRunning = prev?.[2] ?? false;
    const justFinished =
      Boolean(prevRunning || prevStreaming) && !running && !streaming;
    // Follow while generating; also snap once when the turn settles (actions mount).
    if (running || streaming || justFinished) {
      el.scrollTop = el.scrollHeight;
      if (justFinished) {
        requestAnimationFrame(() => {
          const sc = scroller.value;
          if (sc) sc.scrollTop = sc.scrollHeight;
        });
      }
    }
  },
);

function toolCard(msg: Extract<ChatMessage, { role: "tool" }>) {
  return parseToolCard(msg.toolName, msg.args, msg.result);
}

function openPreview(filePath: string): void {
  previewStore.openPreview(filePath);
  rightTabs.addTab("preview", {
    filePath,
    label: filePath.split(/[/\\]/).pop() ?? t.preview,
  });
}

function toolStatus(msg: Extract<ChatMessage, { role: "tool" }>): {
  type: "default" | "success" | "error" | "info";
  label: string;
} {
  if (msg.streaming) return { type: "info", label: t.toolRunning };
  if (msg.isError) return { type: "error", label: t.toolError };
  return { type: "success", label: t.toolDone };
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  messageApi.success(t.copied);
}

function onEditUser(msg: Extract<ChatMessage, { role: "user" }>): void {
  const id = sessionId.value;
  if (!id || props.running) return;
  const edited = chat.beginEditUser(id, msg.id);
  if (!edited) return;
  if (sendQueue.editingId) sendQueue.setEditing(id, null);
  composer.clear();
  composer.draft = edited.text;
  for (const img of edited.images ?? []) {
    composer.addImageFromDataUrl(img.dataUrl);
  }
  for (const tag of edited.elementTags ?? []) {
    if (
      tag.kind === "agent" ||
      tag.kind === "plan" ||
      tag.kind === "ask" ||
      tag.kind === "task"
    ) {
      composer.setMode(tag.kind);
    } else if (tag.kind === "file") {
      composer.addFileTag(tag.content || tag.label || tag.url);
    } else if (tag.kind === "url" || (!tag.kind && /^https?:\/\//i.test(tag.url))) {
      composer.addUrlTag(tag.url);
    } else {
      composer.addCitation({
        url: tag.url,
        selector: "",
        text: tag.content || tag.label || "",
        htmlSnippet: "",
      });
    }
  }
  messageApi.info(t.loadedForReEdit);
}

async function onRegenerate(msg: Extract<ChatMessage, { role: "assistant" }>): Promise<void> {
  const id = sessionId.value;
  if (!id || props.running) return;
  await chat.regenerate(id, msg.id);
}

async function onRetryError(msg: Extract<ChatMessage, { role: "error" }>): Promise<void> {
  const id = sessionId.value;
  if (!id || props.running) return;
  await chat.retryFromError(id, msg.id);
}

function canRevertUser(msg: Extract<ChatMessage, { role: "user" }>): boolean {
  const id = sessionId.value;
  if (!id) return false;
  // Touch byKey so Vue re-renders when checkpoint status flips to ready.
  const s = checkpoints.summaryFor(id, msg.id);
  return s?.status === "ready" && s.fileCount > 0;
}

function isRevertedUser(msg: Extract<ChatMessage, { role: "user" }>): boolean {
  const id = sessionId.value;
  if (!id) return false;
  return checkpoints.summaryFor(id, msg.id)?.status === "reverted";
}

function onRevertUser(msg: Extract<ChatMessage, { role: "user" }>): void {
  const id = sessionId.value;
  if (!id || props.running) return;
  if (!checkpoints.canRevert(id, msg.id)) return;
  dialog.warning({
    title: t.revertTurn,
    content: t.revertTurnConfirm,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: async () => {
      const result = await checkpoints.revert(id, msg.id);
      if (!result.ok) {
        messageApi.error(t.revertTurnFail(result.error || "unknown"));
        return;
      }
      if (result.restored === 0 && result.deleted === 0) {
        messageApi.info(t.revertTurnEmpty);
        return;
      }
      messageApi.success(t.revertTurnDone(result.restored, result.deleted));
    },
  });
}
</script>

<template>
  <div ref="scroller" class="message-list">
    <div class="inner">
      <NEmpty
        v-if="messages.length === 0 && !streaming"
        :description="t.emptyChat"
        style="margin: auto"
      />

      <article
        v-for="msg in displayMessages"
        :key="msg.id"
        class="row"
        :class="[
          `row-${msg.role}`,
          isStickyUser(msg) ? 'row-user-sticky' : '',
          sessionId && chat.isPendingEditTail(sessionId, msg.id) ? 'row-edit-tail' : '',
        ]"
        :data-msg-id="msg.id"
      >
        <template v-if="msg.role === 'user'">
          <div class="bubble-wrap user">
            <div class="bubble user">
              <div v-if="msg.elementTags?.length" class="user-tags">
                <NTag
                  v-for="(tag, idx) in msg.elementTags"
                  :key="`${msg.id}-tag-${idx}`"
                  :type="
                    tag.kind === 'agent' ||
                    tag.kind === 'plan' ||
                    tag.kind === 'ask' ||
                    tag.kind === 'task'
                      ? 'warning'
                      : 'info'
                  "
                  size="small"
                  round
                  class="user-tag"
                  :class="{
                    'user-tag-file': tag.kind === 'file',
                    'user-tag-mode':
                      tag.kind === 'agent' ||
                      tag.kind === 'plan' ||
                      tag.kind === 'ask' ||
                      tag.kind === 'task',
                    [`user-tag-mode-${tag.kind}`]:
                      tag.kind === 'agent' ||
                      tag.kind === 'plan' ||
                      tag.kind === 'ask' ||
                      tag.kind === 'task',
                  }"
                  :title="tag.url || tag.label"
                >
                  {{ tag.label || tag.content }}
                </NTag>
              </div>
              <div v-if="msg.images?.length" class="user-images">
                <NImage
                  v-for="(img, idx) in msg.images"
                  :key="`${msg.id}-img-${idx}`"
                  class="user-image"
                  :src="img.dataUrl"
                  :preview-src="img.dataUrl"
                  object-fit="cover"
                />
              </div>
              <div v-if="msg.text" class="user-plain">{{ msg.text }}</div>
            </div>
            <div
              v-if="!running"
              class="actions user-actions"
              :class="{ 'actions-visible': canRevertUser(msg) || isRevertedUser(msg) }"
            >
              <NTooltip v-if="canRevertUser(msg) || isRevertedUser(msg)">
                <template #trigger>
                  <NButton
                    quaternary
                    circle
                    size="tiny"
                    class="revert-btn"
                    :disabled="isRevertedUser(msg)"
                    :aria-label="isRevertedUser(msg) ? t.reverted : t.revertTurn"
                    @click="onRevertUser(msg)"
                  >
                    <template #icon>
                      <NIcon :component="ArrowUndoOutline" />
                    </template>
                  </NButton>
                </template>
                {{ isRevertedUser(msg) ? t.reverted : t.revertTurnConfirm }}
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="copyText(msg.text)">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                  </NButton>
                </template>
                {{ t.copy }}
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="onEditUser(msg)">
                    <template #icon>
                      <NIcon :component="CreateOutline" />
                    </template>
                  </NButton>
                </template>
                {{ t.reEdit }}
              </NTooltip>
            </div>
          </div>
        </template>

        <template v-else-if="msg.role === 'assistant'">
          <div
            v-if="msg.text || msg.thinking || !msg.streaming"
            class="bubble-wrap assistant"
          >
            <div class="bubble assistant">
              <ThinkingBlock
                v-if="msg.thinking || (msg.streaming && !msg.text)"
                :thinking="msg.thinking ?? ''"
                :streaming="Boolean(msg.streaming && !msg.text)"
              />
              <MarkdownView v-if="msg.text" :content="msg.text" />
              <span v-if="msg.streaming && msg.text" class="cursor" aria-hidden="true" />
            </div>
            <div v-if="!msg.streaming && !running" class="actions">
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="copyText(msg.text)">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                  </NButton>
                </template>
                {{ t.copy }}
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="onRegenerate(msg)">
                    <template #icon>
                      <NIcon :component="RefreshOutline" />
                    </template>
                  </NButton>
                </template>
                {{ t.regenerate }}
              </NTooltip>
            </div>
          </div>
        </template>

        <template v-else-if="msg.role === 'tool'">
          <div class="tool">
            <ToolCallCard
              :card="toolCard(msg)"
              :tool-name="msg.toolName"
              :order="msg.order"
              :status-label="toolStatus(msg).label"
              :status-type="toolStatus(msg).type"
              :streaming="msg.streaming"
              @open="openPreview"
            />
          </div>
        </template>

        <template v-else-if="msg.role === 'error'">
          <div class="bubble-wrap error-wrap">
            <div class="bubble error">{{ msg.text }}</div>
            <NButton
              size="tiny"
              type="primary"
              secondary
              :disabled="running"
              @click="onRetryError(msg)"
            >
              <template #icon>
                <NIcon :component="RefreshOutline" />
              </template>
              {{ t.retryRequest }}
            </NButton>
          </div>
        </template>
      </article>

      <div v-if="retryHint" class="running-indicator retry">
        <span class="dot warn" />
        <NText depth="3" style="font-size: 12px">
          {{ t.retrying(retryHint.attempt, retryHint.maxAttempts) }}
          <span v-if="retryHint.message" class="retry-detail"> · {{ retryHint.message }}</span>
        </NText>
      </div>
      <div v-else-if="running && !streaming" class="running-indicator">
        <span class="dot" />
        <NText depth="3" style="font-size: 12px">{{ t.agentRunning }}</NText>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
  background: var(--bg);
  /* Body defaults to user-select:none — allow selecting chat text to copy. */
  user-select: text;
  -webkit-user-select: text;
}

.inner {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 10px var(--chat-pad-x, 10px) 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
  box-sizing: border-box;
}

.row {
  display: flex;
}

.row-user {
  justify-content: flex-start;
  width: 100%;
}

.row-user-sticky {
  position: sticky;
  top: 0;
  z-index: 6;
  background: var(--bg);
  padding: 6px 0 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #ddd) 55%, transparent);
}

.row-edit-tail {
  opacity: 0.45;
  transition: opacity 0.15s ease;
}

.row-assistant,
.row-tool,
.row-error {
  justify-content: flex-start;
}

.bubble-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}

.bubble-wrap.user {
  align-items: stretch;
  width: 100%;
  max-width: 100%;
}

.bubble-wrap.assistant {
  align-items: flex-start;
  width: 100%;
}

.bubble-wrap.error-wrap {
  align-items: flex-start;
  gap: 8px;
  max-width: 100%;
}

.bubble {
  padding: 9px 13px;
  border-radius: var(--radius-md, 11px);
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

/* Cursor-like user prompt card: soft fill, wide, calm radius. */
.bubble.user {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--fg-muted, #888) 8%, var(--bg-elevated, var(--bg)));
  color: var(--fg-strong);
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 70%, transparent);
  box-shadow: none;
}

.bubble.assistant {
  background: transparent;
  padding: 2px 0;
  width: 100%;
}

.bubble.error {
  background: rgba(208, 48, 80, 0.08);
  border: 1px solid rgba(208, 48, 80, 0.35);
  color: var(--fg-strong);
}

.user-tags,
.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.user-tag {
  max-width: 200px;
}

.user-tag-file {
  font-family: var(--font-mono);
  font-size: 11px;
}

.user-tag-mode-plan {
  --n-color: rgba(234, 179, 8, 0.2) !important;
  --n-text-color: #a16207 !important;
  --n-border: rgba(202, 138, 4, 0.45) !important;
}

.user-tag-mode-agent {
  --n-color: rgba(113, 113, 122, 0.16) !important;
  --n-text-color: #3f3f46 !important;
  --n-border: rgba(113, 113, 122, 0.4) !important;
}

.user-tag-mode-ask {
  --n-color: rgba(59, 130, 246, 0.16) !important;
  --n-text-color: #1d4ed8 !important;
  --n-border: rgba(37, 99, 235, 0.4) !important;
}

.user-tag-mode-task {
  --n-color: rgba(16, 185, 129, 0.16) !important;
  --n-text-color: #047857 !important;
  --n-border: rgba(5, 150, 105, 0.4) !important;
}

.user-tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-image {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  overflow: hidden;
}

.user-plain {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13.5px;
  line-height: 1.55;
  user-select: text;
  -webkit-user-select: text;
}

.actions {
  display: flex;
  gap: 2px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.12s ease;
}

/* Cursor: action icons under the prompt, left-aligned (undo / copy / edit). */
.user-actions {
  justify-content: flex-start;
  margin-top: 2px;
  padding-left: 2px;
}

.actions.actions-visible,
.bubble-wrap:hover .actions {
  opacity: 1;
}

.revert-btn {
  color: var(--fg-muted);
}

.cursor {
  display: inline-block;
  width: 6px;
  height: 14px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--accent);
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.tool {
  width: 100%;
  max-width: 100%;
}

.running-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.dot.warn {
  background: #f0a020;
}

.retry-detail {
  opacity: 0.8;
}

@keyframes pulse {
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
</style>
