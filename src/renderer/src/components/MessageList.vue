<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NIcon,
  NImage,
  NSpin,
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

/** Keep a sliding window of recent messages mounted; older ones become a spacer. */
const VIRTUAL_WINDOW = 48;
const VIRTUAL_CHUNK = 24;
const EST_MSG_HEIGHT = 112;
const NEAR_BOTTOM_PX = 96;
/** Sticky user card must never cover the whole viewport (agent output would look "stuck"). */
const STICKY_MAX_VH = 0.38;

const props = defineProps<{
  messages: ChatMessage[];
  streaming: ChatMessage | null;
  running: boolean;
  retryHint?: ChatRetryHint | null;
  historyLoading?: boolean;
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
/** Avoid follow-bottom immediately undoing the post-send card-bottom scroll. */
let suppressFollowBottomUntil = 0;
/** First index of displayMessages currently mounted in the DOM. */
const renderStart = ref(0);
const heightById = new Map<string, number>();
let expandingHistory = false;
let followBottom = true;
/** Session switch / hydrate settle — snap to bottom, never smooth-scroll. */
let settlingSession = false;
let sessionJumpToken = 0;
/** Template flag: hide list until first bottom snap (avoids blank spacer flash). */
const settlingUi = ref(false);

const displayMessages = computed(() => {
  const list = [...props.messages];
  if (props.streaming) list.push(props.streaming);
  return list;
});

const visibleMessages = computed(() => displayMessages.value.slice(renderStart.value));

const topSpacerPx = computed(() => {
  const all = displayMessages.value;
  let h = 0;
  for (let i = 0; i < renderStart.value; i++) {
    const id = all[i]?.id;
    h += (id && heightById.get(id)) || EST_MSG_HEIGHT;
  }
  return h;
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

function stickyCapPx(sc: HTMLElement): number {
  return Math.min(Math.round(sc.clientHeight * STICKY_MAX_VH), 360);
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

function clampRenderWindow(preferBottom: boolean): void {
  const len = displayMessages.value.length;
  if (len <= VIRTUAL_WINDOW) {
    renderStart.value = 0;
    return;
  }
  if (preferBottom) {
    renderStart.value = Math.max(0, len - VIRTUAL_WINDOW);
  } else {
    renderStart.value = Math.min(renderStart.value, Math.max(0, len - VIRTUAL_WINDOW));
  }
}

function measureVisibleRows(): void {
  const sc = scroller.value;
  if (!sc) return;
  const rows = sc.querySelectorAll<HTMLElement>(".row[data-msg-id]");
  for (const row of rows) {
    const id = row.dataset.msgId;
    if (!id) continue;
    // Use layout height (includes sticky max-height clamp).
    const h = row.offsetHeight;
    if (h > 0) heightById.set(id, h);
  }
}

function expandHistoryUp(): void {
  if (expandingHistory || renderStart.value <= 0) return;
  const sc = scroller.value;
  if (!sc) return;
  expandingHistory = true;
  const prevStart = renderStart.value;
  const nextStart = Math.max(0, prevStart - VIRTUAL_CHUNK);
  let added = 0;
  const all = displayMessages.value;
  for (let i = nextStart; i < prevStart; i++) {
    const id = all[i]?.id;
    added += (id && heightById.get(id)) || EST_MSG_HEIGHT;
  }
  renderStart.value = nextStart;
  void nextTick(() => {
    sc.scrollTop += added;
    measureVisibleRows();
    expandingHistory = false;
  });
}

function jumpToBottomInstant(): void {
  const sc = scroller.value;
  if (!sc) return;
  sc.scrollTop = sc.scrollHeight;
  requestAnimationFrame(() => {
    const el = scroller.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      const el2 = scroller.value;
      if (el2) el2.scrollTop = el2.scrollHeight;
    });
  });
}

async function snapSessionToBottom(token: number): Promise<void> {
  if (token !== sessionJumpToken) return;
  followBottom = true;
  clampRenderWindow(true);
  lastPinnedUserId = latestUserMessageId.value;
  await nextTick();
  if (token !== sessionJumpToken) return;
  measureVisibleRows();
  jumpToBottomInstant();
}

/** Cold start + session switch: wait for hydrate, then land on bottom (no blank spacer). */
async function beginSessionSettle(): Promise<void> {
  const token = ++sessionJumpToken;
  settlingSession = true;
  settlingUi.value = true;
  heightById.clear();
  followBottom = true;
  renderStart.value = 0;

  // History load is async after activeId flips — wait for messages / load end before revealing.
  const deadline = Date.now() + 8_000;
  while (token === sessionJumpToken && Date.now() < deadline) {
    const stillLoading = Boolean(props.historyLoading);
    if (!stillLoading) {
      // Allow one frame for hydrate to land after loading clears.
      await new Promise<void>((r) => setTimeout(r, 16));
      break;
    }
    await new Promise<void>((r) => setTimeout(r, 40));
  }
  if (token !== sessionJumpToken) return;

  // Empty brand-new sessions finish quickly; long histories may still be painting.
  if (displayMessages.value.length === 0) {
    const emptyDeadline = Date.now() + 400;
    while (
      token === sessionJumpToken &&
      displayMessages.value.length === 0 &&
      Date.now() < emptyDeadline
    ) {
      await new Promise<void>((r) => setTimeout(r, 40));
    }
  }
  if (token !== sessionJumpToken) return;

  await snapSessionToBottom(token);
  for (const waitMs of [0, 50, 120, 280, 600]) {
    if (waitMs) await new Promise<void>((r) => setTimeout(r, waitMs));
    if (token !== sessionJumpToken) return;
    await snapSessionToBottom(token);
  }
  if (token === sessionJumpToken) {
    settlingSession = false;
    settlingUi.value = false;
    // Final snap after reveal (layout may change when visibility returns).
    await nextTick();
    jumpToBottomInstant();
  }
}

function onScrollerScroll(): void {
  const sc = scroller.value;
  if (!sc || expandingHistory || settlingSession) return;
  // During post-send pin, smooth scroll may leave us away from the true bottom;
  // keep follow enabled so streaming output still becomes visible.
  if (Date.now() < suppressFollowBottomUntil) {
    followBottom = true;
  } else {
    followBottom = isNearBottom(sc);
  }
  if (sc.scrollTop < 160) expandHistoryUp();
  if (followBottom) {
    const len = displayMessages.value.length;
    const ideal = Math.max(0, len - VIRTUAL_WINDOW);
    if (renderStart.value < ideal) renderStart.value = ideal;
  }
}

watch(
  () => sessionId.value,
  () => {
    void beginSessionSettle();
  },
);

watch(
  () => props.historyLoading,
  (loading, wasLoading) => {
    // History finished while settling — snap immediately (don't wait for poll tick).
    if (wasLoading && !loading && settlingSession) {
      void snapSessionToBottom(sessionJumpToken);
    }
  },
);

watch(
  () => displayMessages.value.length,
  (len, prevLen) => {
    const grew = prevLen != null && len > prevLen;
    const hydratedFromEmpty = (prevLen === 0 || prevLen == null) && len > 0;
    // New messages while following bottom → keep a trailing window.
    if (followBottom || hydratedFromEmpty || (grew && props.running)) {
      clampRenderWindow(true);
    } else if (len <= VIRTUAL_WINDOW) {
      renderStart.value = 0;
    }
    // Critical: hydrate often lands AFTER settle timeouts. Always snap when
    // following bottom / first populate, otherwise the virtual spacer stays in view (blank).
    if (followBottom || settlingSession || hydratedFromEmpty) {
      lastPinnedUserId = latestUserMessageId.value;
      void nextTick(() => {
        jumpToBottomInstant();
      });
    }
  },
  { immediate: true },
);

/** Hydrate can replace history with the same length — still need a bottom snap. */
watch(
  () => props.messages.at(-1)?.id ?? null,
  (id, prev) => {
    if (!id || id === prev) return;
    if (!(followBottom || settlingSession)) return;
    clampRenderWindow(true);
    lastPinnedUserId = latestUserMessageId.value;
    void nextTick(() => jumpToBottomInstant());
  },
);

/** When a new latest user message appears (send / re-edit send): pin card, leave room for agent. */
watch(
  () => latestUserMessageId.value,
  async (id) => {
    if (!id || id === lastPinnedUserId) return;
    lastPinnedUserId = id;
    followBottom = true;
    clampRenderWindow(true);
    // Session switch / hydrate: land on bottom instantly (no slide).
    if (settlingSession) {
      await nextTick();
      jumpToBottomInstant();
      return;
    }
    // Brief pause so follow-bottom doesn't yank away before layout settles.
    suppressFollowBottomUntil = Date.now() + 160;
    await nextTick();
    measureVisibleRows();
    const sc = scroller.value;
    const card = sc?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!sc || !card) return;
    const cap = stickyCapPx(sc);
    // Tall prompts are clamped by sticky max-height; park the card near the top
    // so agent streaming has visible space underneath (not covered by sticky paint).
    if (card.scrollHeight > cap + 24) {
      sc.scrollTo({ top: Math.max(0, card.offsetTop - 4), behavior: "smooth" });
      return;
    }
    const scRect = sc.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const top = cardRect.bottom - scRect.top + sc.scrollTop - sc.clientHeight + 8;
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
      if (!followBottom && !justFinished) return;
      el.scrollTop = el.scrollHeight;
      measureVisibleRows();
      if (justFinished) {
        requestAnimationFrame(() => {
          const sc = scroller.value;
          if (sc) sc.scrollTop = sc.scrollHeight;
        });
      }
    }
  },
);

onMounted(() => {
  const sc = scroller.value;
  sc?.addEventListener("scroll", onScrollerScroll, { passive: true });
  // Auto-load on startup mounts MessageList *after* activeId is set, so the
  // sessionId watcher may not re-fire — settle here or the spacer looks blank.
  void beginSessionSettle();
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener("scroll", onScrollerScroll);
});

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
  <div class="message-list-root">
    <div
      v-if="historyLoading || settlingUi"
      class="history-loading"
      aria-live="polite"
      aria-busy="true"
    >
      <NSpin size="small" />
      <span>{{ t.loadingChatHistory }}</span>
    </div>
    <div ref="scroller" class="message-list" :class="{ 'is-settling': settlingUi }">
    <div class="inner">
      <NEmpty
        v-if="messages.length === 0 && !streaming && !historyLoading && !settlingUi"
        :description="t.emptyChat"
        style="margin: auto"
      />

      <div
        v-if="topSpacerPx > 0"
        class="virtual-spacer"
        :style="{ height: `${topSpacerPx}px` }"
        aria-hidden="true"
      />

      <article
        v-for="msg in visibleMessages"
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
              <!-- Cursor-style: revert lives inside the card, bottom-right -->
              <div
                v-if="canRevertUser(msg) || isRevertedUser(msg)"
                class="user-bubble-footer"
              >
                <NTooltip placement="top">
                  <template #trigger>
                    <button
                      type="button"
                      class="bubble-revert"
                      :disabled="running || isRevertedUser(msg)"
                      :aria-label="isRevertedUser(msg) ? t.reverted : t.revertTurn"
                      @click.stop="onRevertUser(msg)"
                    >
                      <NIcon :component="ArrowUndoOutline" :size="15" />
                    </button>
                  </template>
                  {{ isRevertedUser(msg) ? t.reverted : t.revertTurn }}
                </NTooltip>
              </div>
            </div>
            <div v-if="!running" class="actions user-actions">
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
  </div>
</template>

<style scoped>
.message-list-root {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.history-loading {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--fg-muted);
  font-size: 13px;
  background: color-mix(in srgb, var(--bg) 82%, transparent);
  backdrop-filter: blur(2px);
  pointer-events: none;
  animation: history-fade-in var(--duration, 180ms) var(--ease-out, ease);
}

@keyframes history-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.message-list {
  flex: 1;
  overflow: auto;
  min-height: 0;
  background: var(--bg);
  /* Body defaults to user-select:none — allow selecting chat text to copy. */
  user-select: text;
  -webkit-user-select: text;
}

.message-list.is-settling {
  /* Hide until scrolled to bottom so the virtual spacer is not shown as a blank chat. */
  visibility: hidden;
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

.virtual-spacer {
  flex-shrink: 0;
  width: 100%;
  pointer-events: none;
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
  /* Cap height so a huge prompt cannot paint over the whole chat (looks like agent stuck). */
  max-height: min(38vh, 360px);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
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

.user-bubble-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 6px;
  min-height: 22px;
}

.bubble-revert {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted, #8a8a8a);
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}

.bubble-revert:hover:not(:disabled) {
  color: var(--fg-strong, #222);
  background: color-mix(in srgb, var(--fg-muted, #888) 12%, transparent);
}

.bubble-revert:disabled {
  opacity: 0.45;
  cursor: default;
}

.actions {
  display: flex;
  gap: 2px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.12s ease;
}

/* Copy / re-edit under the prompt (hover). Revert is inside the bubble. */
.user-actions {
  justify-content: flex-start;
  margin-top: 2px;
  padding-left: 2px;
}

.bubble-wrap:hover .actions {
  opacity: 1;
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
