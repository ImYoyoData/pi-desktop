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

const displayMessages = computed(() => {
  const list = [...props.messages];
  if (props.streaming) list.push(props.streaming);
  return list;
});

const sessionId = computed(() => sessions.activeId);

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
    if (tag.kind === "file") {
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

watch(
  () => [props.messages.length, props.streaming, props.running],
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
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
          sessionId && chat.isPendingEditTail(sessionId, msg.id) ? 'row-edit-tail' : '',
        ]"
      >
        <template v-if="msg.role === 'user'">
          <div class="bubble-wrap user">
            <div class="bubble user">
              <div v-if="msg.elementTags?.length" class="user-tags">
                <NTag
                  v-for="(tag, idx) in msg.elementTags"
                  :key="`${msg.id}-tag-${idx}`"
                  type="info"
                  size="small"
                  round
                  class="user-tag"
                  :class="{ 'user-tag-file': tag.kind === 'file' }"
                  :title="tag.url || tag.label"
                >
                  {{ tag.kind === "file" ? tag.content || tag.label : tag.content || tag.label }}
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
              <MarkdownView v-if="msg.text" :content="msg.text" />
            </div>
            <div
              v-if="!running"
              class="actions"
              :class="{ 'actions-visible': canRevertUser(msg) || isRevertedUser(msg) }"
            >
              <NTooltip v-if="canRevertUser(msg) || isRevertedUser(msg)">
                <template #trigger>
                  <NButton
                    quaternary
                    size="tiny"
                    class="revert-btn"
                    :disabled="isRevertedUser(msg)"
                    @click="onRevertUser(msg)"
                  >
                    <template #icon>
                      <NIcon :component="ArrowUndoOutline" />
                    </template>
                    {{ isRevertedUser(msg) ? t.reverted : t.revertTurn }}
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
          <div class="bubble-wrap assistant">
            <div class="bubble assistant">
              <MarkdownView :content="msg.text || (msg.streaming ? '…' : '')" />
              <span v-if="msg.streaming" class="cursor" aria-hidden="true" />
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
  justify-content: flex-end;
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
  align-items: flex-end;
  max-width: 92%;
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
}

.bubble.user {
  background: var(--user-bg);
  color: var(--fg-strong);
  border: 1px solid color-mix(in srgb, var(--accent) 14%, var(--border));
  box-shadow: var(--shadow-sm);
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

.user-tag-file {
  font-family: var(--font-mono);
  font-size: 11px;
  max-width: min(420px, 70vw);
}

.user-tag-file :deep(.n-tag__content) {
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

.actions {
  display: flex;
  gap: 2px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.actions.actions-visible,
.bubble-wrap:hover .actions {
  opacity: 1;
}

.revert-btn {
  font-size: 11px;
  padding: 0 6px !important;
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
