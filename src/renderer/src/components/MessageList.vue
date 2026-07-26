<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NIcon,
  NImage,
  NSpace,
  NTag,
  NText,
  NTooltip,
  useMessage,
} from "naive-ui";
import {
  CopyOutline,
  CreateOutline,
  DocumentTextOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import type { ChatMessage, ChatRetryHint } from "@renderer/stores/chat";
import { useChatStore } from "@renderer/stores/chat";
import { useComposerStore } from "@renderer/stores/composer";
import { useSessionsStore } from "@renderer/stores/sessions";
import MarkdownView from "@renderer/components/MarkdownView.vue";
import { extractWorkspacePaths } from "@renderer/utils/preview-paths";
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
const composer = useComposerStore();
const sessions = useSessionsStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const messageApi = useMessage();
const scroller = ref<HTMLElement | null>(null);
const expandedTools = ref<string[]>([]);

const displayMessages = computed(() => {
  const list = [...props.messages];
  if (props.streaming) list.push(props.streaming);
  return list;
});

const sessionId = computed(() => sessions.activeId);

function toolPaths(msg: Extract<ChatMessage, { role: "tool" }>): string[] {
  const fromArgs = extractWorkspacePaths(msg.args);
  const fromResult = extractWorkspacePaths(msg.result);
  return [...new Set([...fromArgs, ...fromResult])];
}

function openPreview(filePath: string): void {
  previewStore.openPreview(filePath);
  rightTabs.addTab("preview", {
    filePath,
    label: filePath.split(/[/\\]/).pop() ?? "预览",
  });
}

function formatArgs(args: unknown): string {
  if (args === undefined) return "";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
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
  messageApi.success("已复制");
}

function onEditUser(msg: Extract<ChatMessage, { role: "user" }>): void {
  const id = sessionId.value;
  if (!id || props.running) return;
  const text = chat.beginEditUser(id, msg.id);
  if (text == null) return;
  composer.draft = text;
  messageApi.info("已载入到输入框，发送后将从此处重新开始");
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
        :class="`row-${msg.role}`"
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
                  :title="tag.url"
                >
                  {{ tag.content || tag.label }}
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
            <div v-if="!running" class="actions">
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="copyText(msg.text)">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                  </NButton>
                </template>
                复制
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="onEditUser(msg)">
                    <template #icon>
                      <NIcon :component="CreateOutline" />
                    </template>
                  </NButton>
                </template>
                重新编辑
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
                复制
              </NTooltip>
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="onRegenerate(msg)">
                    <template #icon>
                      <NIcon :component="RefreshOutline" />
                    </template>
                  </NButton>
                </template>
                重新生成
              </NTooltip>
            </div>
          </div>
        </template>

        <template v-else-if="msg.role === 'tool'">
          <div class="tool">
            <NCollapse v-model:expanded-names="expandedTools">
              <NCollapseItem :name="msg.id">
                <template #header>
                  <NSpace :size="8" align="center">
                    <NText code style="font-size: 12px">{{ msg.toolName }}</NText>
                    <NTag size="tiny" :type="toolStatus(msg).type" :bordered="false">
                      {{ toolStatus(msg).label }}
                    </NTag>
                  </NSpace>
                </template>
                <pre class="tool-body">{{ formatArgs(msg.args ?? msg.result) }}</pre>
                <NSpace v-if="toolPaths(msg).length" size="small" style="margin-top: 8px">
                  <NButton
                    v-for="filePath in toolPaths(msg)"
                    :key="filePath"
                    size="tiny"
                    secondary
                    @click="openPreview(filePath)"
                  >
                    <template #icon>
                      <NIcon :component="DocumentTextOutline" />
                    </template>
                    {{ filePath }}
                  </NButton>
                </NSpace>
              </NCollapseItem>
            </NCollapse>
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
  width: 100%;
  align-items: flex-start;
}

.actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.bubble-wrap:hover .actions {
  opacity: 1;
}

.bubble {
  max-width: 100%;
  font-size: 13px;
  line-height: 1.5;
  user-select: text;
}

.bubble.user {
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--user-bg);
  color: var(--fg-strong);
}

.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.user-images:last-child {
  margin-bottom: 0;
}

.user-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.user-tags:last-child {
  margin-bottom: 0;
}

.user-image {
  display: block;
  max-width: min(240px, 100%);
  max-height: 180px;
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  cursor: zoom-in;
}

.user-image :deep(img) {
  max-width: min(240px, 100%);
  max-height: 180px;
  object-fit: cover;
}

.bubble.assistant {
  width: 100%;
  color: var(--fg);
  padding: 1px 0;
}

.bubble.error {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(220, 38, 38, 0.08);
  border: 1px solid rgba(220, 38, 38, 0.25);
  color: #b91c1c;
  font-size: 13px;
  max-width: 92%;
}

.error-wrap {
  align-items: flex-start;
  gap: 8px;
}

.running-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.running-indicator.retry .retry-detail {
  opacity: 0.75;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent);
  animation: pulse 1.2s ease-in-out infinite;
}

.dot.warn {
  background: #d97706;
}

.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  background: var(--accent);
  animation: blink 1s step-end infinite;
  vertical-align: text-bottom;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.tool {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--tool-bg);
  overflow: hidden;
  padding: 0 8px;
}

.tool-body {
  margin: 0;
  padding: 8px 4px;
  font-size: 12px;
  overflow: auto;
  max-height: 200px;
  background: var(--bg);
  color: var(--fg-muted);
  font-family: var(--font-mono);
  border-radius: 6px;
  user-select: text;
}

@keyframes pulse {
  50% {
    opacity: 0.35;
  }
}
</style>
