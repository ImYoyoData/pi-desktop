<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import { ArrowDownOutline, ArrowUndoOutline, ChevronDownOutline, ChevronUpOutline, CopyOutline, CreateOutline, PauseOutline, RefreshOutline, VolumeMediumOutline } from "@vicons/ionicons5";
import type { ChatMessage, ChatRetryHint } from "@renderer/stores/chat";
import { useChatStore } from "@renderer/stores/chat";
import { useCheckpointStore } from "@renderer/stores/checkpoint";
import { useComposerStore } from "@renderer/stores/composer";
import { useSendQueueStore } from "@renderer/stores/send-queue";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useTtsStore } from "@renderer/stores/tts";
/**
 * Markdown rendering pulls katex / marked / highlight.js — load it lazily
 * so opening a session with many messages stays responsive on slow CPUs.
 */
const MarkdownView = defineAsyncComponent(
  () => import("@renderer/components/MarkdownView.vue"),
);

import ThinkingBlock from "@renderer/components/ThinkingBlock.vue";
import ToolCallCard from "@renderer/components/ToolCallCard.vue";
import ToolCallGroup from "@renderer/components/ToolCallGroup.vue";
import AgentWaitIndicator from "@renderer/components/AgentWaitIndicator.vue";
import { parseToolCard, isReadTool, type ToolCard } from "@renderer/utils/tool-diff";
import { buildToolGroupSpans } from "@renderer/utils/tool-group";
import { agentOutputSilenceMs } from "@renderer/utils/agent-wait";
import type { ChatState } from "@renderer/stores/chat-reducer";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { t } from "@renderer/i18n";
import {
  isComposerAgentMode,
  stripComposerModePreamble,
} from "../../../shared/composer-modes";
import { ASK_USER_TOOL_NAME } from "../../../shared/ask-user";
import {
  followBottomVirtualWindow,
  windowAfterHistoryPrepend,
} from "@renderer/utils/message-virtual-window";
import { decideFollowOnScroll } from "@renderer/utils/follow-bottom";

/**
 * Sliding virtual window: mount a modest range around the viewport so
 * opening a long shared Pi session stays interactive (overscan above + below).
 */
const VIRTUAL_WINDOW = 32;
/** Soft cap before trimming the far side of the window. */
const VIRTUAL_MAX = 48;
const VIRTUAL_CHUNK = 16;
const EST_MSG_HEIGHT = 120;
/** Collapsed tool-group summary row (Cursor-style). */
const EST_TOOL_GROUP_HEIGHT = 40;
const NEAR_BOTTOM_PX = 120;
/**
 * Prefetch distance to spacers. Keep modest — large overscan + recursive expand
 * remounted Markdown/tool rows and froze the whole Electron UI while dragging.
 */
const OVERSCAN_PX = 280;
/** Sticky user card must never cover the whole viewport (agent output would look "stuck"). */
const STICKY_MAX_VH = 0.16;
const STICKY_MAX_PX = 110;

const props = defineProps<{
  messages: ChatMessage[];
  streaming: ChatMessage | null;
  running: boolean;
  retryHint?: ChatRetryHint | null;
  historyLoading?: boolean;
  historyHasMore?: boolean;
  historyLoadingOlder?: boolean;
}>();

const chat = useChatStore();
const waitState = computed(() => chat.activeWaitState);
/** Keep status visible during long gaps between stream chunks. */
const showWaitWhileStreaming = computed(() => {
  const s = waitState.value;
  if (!s) return false;
  return agentOutputSilenceMs(s as ChatState) >= 15_000;
});
const checkpoints = useCheckpointStore();
const composer = useComposerStore();
const sendQueue = useSendQueueStore();
const sessions = useSessionsStore();
const previewStore = usePreviewStore();
const rightTabs = useRightTabsStore();
const tts = useTtsStore();
const messageApi = useMessage();

/**
 * Custom image lightbox: click to zoom, right-click to copy / save.
 * naive-ui's built-in preview has no clipboard integration.
 */
type ImagePreview = { dataUrl: string; mimeType: string };
const imagePreview = ref<ImagePreview | null>(null);
const previewMenuOpen = ref(false);
const previewMenuPos = ref({ x: 0, y: 0 });

function openImagePreview(img: { dataUrl: string; mimeType: string }): void {
  imagePreview.value = { dataUrl: img.dataUrl, mimeType: img.mimeType };
  previewMenuOpen.value = false;
}

function closeImagePreview(): void {
  imagePreview.value = null;
  previewMenuOpen.value = false;
}

function openPreviewMenu(event: MouseEvent): void {
  previewMenuOpen.value = true;
  const menuW = 160;
  const menuH = 76;
  previewMenuPos.value = {
    x: Math.max(4, Math.min(event.clientX, window.innerWidth - menuW - 4)),
    y: Math.max(4, Math.min(event.clientY, window.innerHeight - menuH - 4)),
  };
}

async function copyPreviewImage(): Promise<void> {
  const preview = imagePreview.value;
  if (!preview) return;
  try {
    await window.api.clipboard.writeImage(preview.dataUrl);
    previewMenuOpen.value = false;
    messageApi.success(t.copyImageDone);
  } catch (err) {
    previewMenuOpen.value = false;
    messageApi.error(err instanceof Error ? err.message : String(err));
  }
}

function savePreviewImage(): void {
  const preview = imagePreview.value;
  if (!preview) return;
  previewMenuOpen.value = false;
  const a = document.createElement("a");
  a.href = preview.dataUrl;
  const ext = (preview.mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "") || "png";
  a.download = `image-${Date.now()}.${ext}`;
  a.click();
}

function onPreviewKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeImagePreview();
}

watch(imagePreview, (preview) => {
  if (preview) window.addEventListener("keydown", onPreviewKeydown);
  else window.removeEventListener("keydown", onPreviewKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onPreviewKeydown);
  imagePreview.value = null;
});

const dialog = useDialog();
const scroller = ref<HTMLElement | null>(null);
let lastPinnedUserId: string | null = null;
/** Avoid follow-bottom immediately undoing the post-send card-bottom scroll. */
let suppressFollowBottomUntil = 0;
/** Inclusive start / exclusive end of displayMessages currently mounted. */
const renderStart = ref(0);
const renderEnd = ref(0);
const heightById = new Map<string, number>();
/** Real layout offsetTop of measured rows (for accurate sticky pinning). */
const topById = new Map<string, number>();
let adjustingWindow = false;
let followBottom = true;
/**
 * Latched once the user scrolls away from the live edge; cleared only when they
 * scroll back down into the near-bottom zone (or send / jump-to-latest). A pure
 * distance threshold deadlocks while streaming: every chunk snap re-bottoms the
 * viewport, so `isNearBottom` stays true and small upward wheel steps could
 * never escape it.
 */
let userScrolledAway = false;
/** Session switch / hydrate settle — snap to bottom, never smooth-scroll. */
let settlingSession = false;
let sessionJumpToken = 0;
/** Template flag: hide list until first bottom snap (avoids blank spacer flash). */
const settlingUi = ref(false);
/** Show floating jump control when user scrolled away from latest. */
const showJumpLatest = ref(false);
let scrollRaf = 0;

const workFolded = ref(true);

/**
 * When the final answer is shown, the whole latest turn's process (all tool
 * calls + thinking-only rows) folds into one compact summary instead of a
 * stack of individually folded cards.
 */
const latestTurnStart = computed(() => {
  const list = props.messages;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") return i;
  }
  return -1;
});

const processSummaryCounts = computed(() => {
  let tools = 0;
  let thinking = 0;
  const start = latestTurnStart.value;
  const list = props.messages;
  for (let i = start + 1; i < list.length; i++) {
    const m = list[i]!;
    if (m.role === "tool") tools += 1;
    else if (m.role === "assistant" && Boolean(m.thinking) && !m.text) thinking += 1;
  }
  return { tools, thinking };
});

/** True for the synthetic row shown in place of the latest turn's process. */
function processSummaryLabel(msg: ChatMessage): string {
  const args = (msg.role === "tool" ? msg.args : undefined) as
    | { toolCount?: number; thinkingCount?: number }
    | undefined;
  return t.processSummary(args?.toolCount ?? 0, args?.thinkingCount ?? 0);
}

function isProcessSummary(msg: ChatMessage | null | undefined): boolean {
  return Boolean(msg && msg.role === "tool" && msg.toolName === "process-summary");
}

watch([() => props.running, () => props.streaming], ([running, streaming]) => {
  // Auto-fold only when the turn is done and there is work to fold.
  if (running || streaming) {
    workFolded.value = false;
  } else {
    const counts = processSummaryCounts.value;
    workFolded.value = counts.tools + counts.thinking > 0;
  }
}, { immediate: true });

/** Tool rows that must stay visible even in clean history (user questions). */
function isKeepVisibleTool(msg: ChatMessage): boolean {
  return msg.role === "tool" && msg.toolName === ASK_USER_TOOL_NAME;
}

const displayMessages = computed(() => {
  const list = [...props.messages];
  if (props.streaming) list.push(props.streaming);
  const counts = processSummaryCounts.value;
  const foldable = counts.tools + counts.thinking > 0;
  const start = latestTurnStart.value;
  const out: ChatMessage[] = [];
  let inserted = false;
  // Fold the WHOLE latest turn's process — from the user prompt down to the
  // last tool/thinking row — including any assistant text emitted mid-process.
  // Only the final assistant answer (text after the last work row) stays out.
  let lastWorkIndex = -1;
  for (let i = list.length - 1; i > start; i--) {
    const m = list[i]!;
    if (
      m.role === "tool" ||
      (m.role === "assistant" && Boolean(m.thinking) && !m.text)
    ) {
      lastWorkIndex = i;
      break;
    }
  }
  for (let i = 0; i < list.length; i++) {
    const msg = list[i]!;
    const isLatestTurnWork =
      i > start &&
      i <= lastWorkIndex &&
      (msg.role === "tool" ||
        (msg.role === "assistant" && Boolean(msg.thinking) && !msg.text));
    if (isLatestTurnWork) {
      if (!inserted) {
        inserted = true;
        // Folded: one compact summary replaces the whole process.
        // Expanded: the same bar stays on top so the user can fold again.
        out.push({
          id: "__process-summary__",
          role: "tool",
          toolCallId: "__process-summary__",
          toolName: "process-summary",
          args: {
            toolCount: counts.tools,
            thinkingCount: counts.thinking,
            expanded: !workFolded.value,
          },
        } as ChatMessage);
      }
      if (!workFolded.value) out.push(msg);
      continue;
    }
    // Mid-process assistant text emitted between tool calls is part of the
    // latest turn's process — fold it with the tools. Only the text that
    // follows the last work row (the final answer) is kept visible.
    if (
      i > start &&
      i <= lastWorkIndex &&
      msg.role === "assistant" &&
      msg.text
    ) {
      if (!workFolded.value) out.push(msg);
      continue;
    }
    // Older, already-finished turns: drop their tool/thinking rows so the
    // history reads as user messages + final answers only (Codex-like).
    // Interactive ask_user rows stay visible.
    if (
      !isKeepVisibleTool(msg) &&
      (msg.role === "tool" ||
        (msg.role === "assistant" && Boolean(msg.thinking) && !msg.text))
    ) {
      continue;
    }
    out.push(msg);
  }
  return out;
});

type ToolMessage = Extract<ChatMessage, { role: "tool" }>;

type ToolGroupMembership = {
  groupId: string;
  leadId: string;
  isLead: boolean;
  tools: ToolMessage[];
};

/** Consecutive tool calls (2+) collapse into one Cursor-style group. */
const toolGroupMembership = computed(() => {
  const all = displayMessages.value;
  const map = new Map<string, ToolGroupMembership>();
  const spans = buildToolGroupSpans(
    all.map((m) => ({
      id: m.id,
      role: m.role,
      toolName: m.role === "tool" ? m.toolName : "",
    })),
    // Only collapse consecutive reads; write/edit/bash stay standalone
    // so their live streaming diffs stay visible.
    (m) => m.role === "tool" && isReadTool(m.toolName),
  );
  for (const span of spans) {
    const tools = all.slice(span.start, span.end) as ToolMessage[];
    for (let i = 0; i < span.ids.length; i++) {
      map.set(span.ids[i]!, {
        groupId: span.groupId,
        leadId: span.ids[0]!,
        isLead: i === 0,
        tools,
      });
    }
  }
  return map;
});

const visibleMessages = computed(() =>
  displayMessages.value.slice(renderStart.value, renderEnd.value),
);

function estimateMessageHeight(msg: ChatMessage | undefined): number {
  if (!msg) return EST_MSG_HEIGHT;
  const group = toolGroupMembership.value.get(msg.id);
  if (group) {
    if (!group.isLead) return 0;
    return heightById.get(group.leadId) || EST_TOOL_GROUP_HEIGHT;
  }
  return heightById.get(msg.id) || EST_MSG_HEIGHT;
}

function estimateRangeHeight(from: number, to: number): number {
  const all = displayMessages.value;
  let h = 0;
  for (let i = from; i < to; i++) {
    h += estimateMessageHeight(all[i]);
  }
  return h;
}

const topSpacerPx = computed(() => estimateRangeHeight(0, renderStart.value));

const bottomSpacerPx = computed(() =>
  estimateRangeHeight(renderEnd.value, displayMessages.value.length),
);

const latestUserMessageId = computed(() => {
  for (let i = displayMessages.value.length - 1; i >= 0; i--) {
    const m = displayMessages.value[i];
    if (m?.role === "user") return m.id;
  }
  return null;
});

const sessionId = computed(() => sessions.activeId);
/**
 * Cursor-like sticky user prompt:
 * Among user messages scrolled fully above the viewport, pin the nearest
 * (highest index). Overlay uses store text — no need to remount that row.
 */
const stickyExpanded = ref(false);
const stickyNeedsToggle = ref(false);
const stickyHover = ref(false);
const stickyPinId = ref<string | null>(null);
const stickyPinEl = ref<HTMLElement | null>(null);

/** User cards the user explicitly expanded (id → true). Default: collapsed. */
const expandedUserIds = ref(new Set<string>());

function isUserExpanded(id: string): boolean {
  return expandedUserIds.value.has(id);
}

function toggleUserExpanded(id: string): void {
  const next = new Set(expandedUserIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedUserIds.value = next;
}

const stickyPinned = computed(() => stickyPinId.value != null);

const stickyPinMessage = computed(() => {
  const id = stickyPinId.value;
  if (!id) return null;
  const msg = displayMessages.value.find((m) => m.id === id);
  return msg?.role === "user" ? msg : null;
});

function stickyCapPx(sc: HTMLElement): number {
  return Math.min(Math.round(sc.clientHeight * STICKY_MAX_VH), STICKY_MAX_PX);
}

function measureStickyNeedsToggle(naturalHeight: number): void {
  const sc = scroller.value;
  if (!sc || !stickyPinned.value) {
    stickyNeedsToggle.value = false;
    return;
  }
  stickyNeedsToggle.value = naturalHeight > stickyCapPx(sc) + 12;
}

/**
 * Nearest user message fully above the viewport top (Cursor behavior).
 * Uses real measured layout offsets when available (the estimate used to
 * over-count the user card height, pinning messages that had only partially
 * scrolled out of view). Falls back to estimate for unmeasured rows.
 */
function findStickyUserMessageId(): string | null {
  const sc = scroller.value;
  const all = displayMessages.value;
  if (!sc || all.length === 0) return null;

  const viewportTop = sc.scrollTop + 8;
  let bestId: string | null = null;
  let offset = 0;
  let measured = true;

  for (let i = 0; i < all.length; i++) {
    const m = all[i]!;
    const h = estimateMessageHeight(m);
    const top = topById.get(m.id);
    if (top == null) {
      measured = false;
      // Unmeasured rows: fall back to accumulated estimate for the boundary.
      if (m.role === "user" && offset + h < viewportTop) bestId = m.id;
      else if (m.role === "user") break;
    } else {
      // Real position: pin only when the WHOLE row is above the viewport.
      if (m.role === "user") {
        if (top + h < viewportTop) bestId = m.id;
        else break;
      }
    }
    offset += h;
  }

  return bestId;
}

function clearStickyPin(): void {
  if (!stickyPinId.value && !stickyNeedsToggle.value) return;
  stickyPinId.value = null;
  stickyExpanded.value = false;
  stickyHover.value = false;
  stickyNeedsToggle.value = false;
}

/** Pin overlay for the nearest user message scrolled above the viewport. */
function updateStickyPinned(): void {
  const sc = scroller.value;
  if (!sc) {
    clearStickyPin();
    return;
  }

  const id = findStickyUserMessageId();
  if (!id) {
    clearStickyPin();
    return;
  }

  if (id !== stickyPinId.value) {
    stickyPinId.value = id;
    stickyExpanded.value = false;
    stickyHover.value = false;
  }

  // Sticky UI is an overlay copy from store — do NOT expand the virtual window
  // to remount that row (that previously caused unbounded mounts + nextTick loops).
  const body = stickyPinEl.value?.querySelector<HTMLElement>(".sticky-pin-body");
  if (body) {
    measureStickyNeedsToggle(body.scrollHeight);
    return;
  }
  void nextTick(() => {
    const el = stickyPinEl.value?.querySelector<HTMLElement>(".sticky-pin-body");
    if (el) measureStickyNeedsToggle(el.scrollHeight);
  });
}

function refreshStickyToggleNeed(): void {
  void nextTick(() => {
    if (!stickyPinned.value) {
      stickyNeedsToggle.value = false;
      return;
    }
    const pin = stickyPinEl.value;
    const body = pin?.querySelector<HTMLElement>(".sticky-pin-body");
    if (body) {
      measureStickyNeedsToggle(body.scrollHeight);
      return;
    }
    updateStickyPinned();
  });
}

function toggleStickyExpanded(): void {
  stickyExpanded.value = !stickyExpanded.value;
  void nextTick(() => refreshStickyToggleNeed());
}

function onStickyUserEnter(): void {
  if (!stickyPinned.value) return;
  stickyHover.value = true;
  refreshStickyToggleNeed();
}

function onStickyUserLeave(): void {
  stickyHover.value = false;
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

function clampRenderWindow(preferBottom: boolean): void {
  const len = displayMessages.value.length;
  if (len <= VIRTUAL_WINDOW) {
    renderStart.value = 0;
    renderEnd.value = len;
    return;
  }
  if (preferBottom) {
    renderEnd.value = len;
    renderStart.value = Math.max(0, len - VIRTUAL_WINDOW);
    return;
  }
  // Keep current window sized and clamped inside [0, len].
  let start = Math.max(0, Math.min(renderStart.value, len));
  let end = Math.max(start, Math.min(renderEnd.value, len));
  if (end - start < Math.min(VIRTUAL_WINDOW, len)) {
    end = Math.min(len, start + VIRTUAL_WINDOW);
    start = Math.max(0, end - VIRTUAL_WINDOW);
  }
  renderStart.value = start;
  renderEnd.value = end;
}

function measureVisibleRows(): void {
  const sc = scroller.value;
  if (!sc) return;
  const rows = sc.querySelectorAll<HTMLElement>(".row[data-msg-id]");
  for (const row of rows) {
    const id = row.dataset.msgId;
    if (!id) continue;
    // Use layout height for virtual window estimates.
    const h = row.offsetHeight;
    if (h > 0) heightById.set(id, h);
    // Real layout offset inside the scroller (rows are flex children of .inner).
    const top = row.offsetTop;
    if (top > 0 || row === rows[0]) topById.set(id, top);
  }
}

function restoreScrollAfterMutation(sc: HTMLElement, prevHeight: number, prevTop: number): void {
  const delta = sc.scrollHeight - prevHeight;
  sc.scrollTop = prevTop + delta;
}

/** After a window mutate, continue prefetch on the next frame (yields to paint — no nextTick storm). */
function scheduleWindowPrefetch(): void {
  requestAnimationFrame(() => {
    const sc = scroller.value;
    if (!sc || adjustingWindow || settlingSession || followBottom) return;
    if (sc.scrollTop < topSpacerPx.value + OVERSCAN_PX) {
      expandHistoryUp();
      return;
    }
    const bottomEdge = sc.scrollHeight - bottomSpacerPx.value;
    if (sc.scrollTop + sc.clientHeight > bottomEdge - OVERSCAN_PX) {
      expandHistoryDown();
    }
  });
}

function expandHistoryUp(): void {
  if (adjustingWindow || renderStart.value <= 0) {
    // At the start of the *loaded* window — fetch an older page from disk if any.
    if (renderStart.value <= 0 && !adjustingWindow) {
      void loadOlderHistoryPage();
    }
    return;
  }
  const sc = scroller.value;
  if (!sc) return;
  adjustingWindow = true;
  const prevHeight = sc.scrollHeight;
  const prevTop = sc.scrollTop;
  const nextStart = Math.max(0, renderStart.value - VIRTUAL_CHUNK);
  renderStart.value = nextStart;
  // Trim far (bottom) side so mounting stays bounded while scrolling up.
  if (renderEnd.value - renderStart.value > VIRTUAL_MAX) {
    renderEnd.value = renderStart.value + VIRTUAL_MAX;
  }
  void nextTick(() => {
    restoreScrollAfterMutation(sc, prevHeight, prevTop);
    measureVisibleRows();
    adjustingWindow = false;
    updateStickyPinned();
    if (renderStart.value <= 0) {
      void loadOlderHistoryPage();
    } else {
      scheduleWindowPrefetch();
    }
  });
}

let loadingOlderPage = false;
async function loadOlderHistoryPage(): Promise<void> {
  if (loadingOlderPage || !props.historyHasMore) return;
  const id = sessionId.value;
  if (!id) return;
  const sc = scroller.value;
  if (!sc) return;
  loadingOlderPage = true;
  adjustingWindow = true;
  const prevHeight = sc.scrollHeight;
  const prevTop = sc.scrollTop;
  try {
    const added = await chat.loadOlderHistory(id);
    if (added <= 0) return;
    // Prepend shifts every index — keep the same rows mounted, then peek a chunk older.
    const shifted = windowAfterHistoryPrepend(
      { start: renderStart.value, end: renderEnd.value },
      added,
      displayMessages.value.length,
      VIRTUAL_MAX,
      VIRTUAL_CHUNK,
    );
    renderStart.value = shifted.start;
    renderEnd.value = shifted.end;
    await nextTick();
    restoreScrollAfterMutation(sc, prevHeight, prevTop);
    measureVisibleRows();
    updateStickyPinned();
    scheduleWindowPrefetch();
  } finally {
    adjustingWindow = false;
    loadingOlderPage = false;
  }
}

function expandHistoryDown(): void {
  if (adjustingWindow) return;
  const len = displayMessages.value.length;
  if (renderEnd.value >= len) return;
  const sc = scroller.value;
  if (!sc) return;
  adjustingWindow = true;
  const prevHeight = sc.scrollHeight;
  const prevTop = sc.scrollTop;
  renderEnd.value = Math.min(len, renderEnd.value + VIRTUAL_CHUNK);
  // Trim far (top) side — never grow past VIRTUAL_MAX (sticky is overlay-only).
  if (renderEnd.value - renderStart.value > VIRTUAL_MAX) {
    renderStart.value = Math.max(0, renderEnd.value - VIRTUAL_MAX);
  }
  void nextTick(() => {
    restoreScrollAfterMutation(sc, prevHeight, prevTop);
    measureVisibleRows();
    adjustingWindow = false;
    updateStickyPinned();
    scheduleWindowPrefetch();
  });
}

let instantSnapToken = 0;
function jumpToBottomInstant(): void {
  const sc = scroller.value;
  if (!sc) return;
  const token = ++instantSnapToken;
  sc.scrollTop = sc.scrollHeight;
  // Deferred re-snaps must re-check follow: the user may scroll up while these
  // rAFs are still queued — never yank the viewport back down afterwards.
  requestAnimationFrame(() => {
    if (token !== instantSnapToken || (!followBottom && !settlingSession)) return;
    const el = scroller.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      if (token !== instantSnapToken || (!followBottom && !settlingSession)) return;
      const el2 = scroller.value;
      if (el2) el2.scrollTop = el2.scrollHeight;
    });
  });
}

/**
 * Coalesced follow-bottom scroll for streaming updates. Forcing layout three
 * times per tool_execution_update (immediate + two rAF re-sets) starved the UI
 * thread while bash/write output streamed. One scrollTop set per animation
 * frame is enough; later updates simply re-schedule.
 */
let bottomScrollRaf = 0;
function scheduleBottomScroll(): void {
  // Minimized / hidden: no layout work until the window is restored.
  if (document.hidden) return;
  if (bottomScrollRaf) return;
  bottomScrollRaf = requestAnimationFrame(() => {
    bottomScrollRaf = 0;
    const sc = scroller.value;
    // Re-check at fire time, not just schedule time: the user may have scrolled
    // up after the snap was queued (the follow decision is sync, this rAF is
    // not) — never yank the viewport back down while they read history.
    if (!sc || document.hidden || !followBottom) return;
    sc.scrollTop = sc.scrollHeight;
  });
}

/** Restored from minimized: land at the live edge without a big re-measure. */
function onVisibilityChange(): void {
  if (document.hidden) return;
  if (!followBottom) return;
  clampRenderWindow(true);
  scheduleBottomScroll();
  requestAnimationFrame(() => {
    measureVisibleRows();
    scheduleBottomScroll();
  });
}

function jumpToLatest(): void {
  followBottom = true;
  userScrolledAway = false;
  showJumpLatest.value = false;
  clampRenderWindow(true);
  void nextTick(() => {
    measureVisibleRows();
    jumpToBottomInstant();
  });
}

async function snapSessionToBottom(token: number): Promise<void> {
  if (token !== sessionJumpToken) return;
  followBottom = true;
  userScrolledAway = false;
  showJumpLatest.value = false;
  clampRenderWindow(true);
  lastPinnedUserId = latestUserMessageId.value;
  await nextTick();
  if (token !== sessionJumpToken) return;
  measureVisibleRows();
  jumpToBottomInstant();
  updateStickyPinned();
  refreshStickyToggleNeed();
}

/** Cold start + session switch: wait for hydrate, then land on bottom (no blank spacer). */
async function beginSessionSettle(): Promise<void> {
  const token = ++sessionJumpToken;
  settlingSession = true;
  settlingUi.value = true;
  heightById.clear();
  followBottom = true;
  userScrolledAway = false;
  showJumpLatest.value = false;
  renderStart.value = 0;
  renderEnd.value = 0;

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

/**
 * Cheap, synchronous follow-bottom decision on every scroll event. Must NOT be
 * rAF-deferred: stream snaps are themselves scheduled on rAFs, so deferring
 * this let an already-queued snap run with a stale followBottom=true and yank
 * the viewport back to the bottom while the user was reading history above.
 */
let lastSyncScrollTop = -1;
function cancelQueuedBottomSnaps(): void {
  if (bottomScrollRaf) {
    cancelAnimationFrame(bottomScrollRaf);
    bottomScrollRaf = 0;
  }
  // Invalidate instant-snap rAF chains queued before the user scrolled away.
  instantSnapToken++;
}

function syncFollowBottomOnScroll(sc: HTMLElement): void {
  const decision = decideFollowOnScroll({
    top: sc.scrollTop,
    lastTop: lastSyncScrollTop,
    nearBottom: isNearBottom(sc),
    now: Date.now(),
    suppressUntil: suppressFollowBottomUntil,
    away: userScrolledAway,
    following: followBottom,
    guarded: adjustingWindow || settlingSession,
  });
  lastSyncScrollTop = sc.scrollTop;
  userScrolledAway = decision.away;
  suppressFollowBottomUntil = decision.suppressUntil;
  followBottom = decision.following;
  if (!followBottom) cancelQueuedBottomSnaps();
  showJumpLatest.value = !followBottom && displayMessages.value.length > 0;
}

/**
 * Wheel events only fire for real user input (programmatic scrollTop writes do
 * not). One upward tick disengages follow immediately — even inside the
 * near-bottom threshold, where stream snaps would otherwise keep resetting the
 * user's scroll progress every chunk and they could never escape.
 */
function onScrollerWheel(event: WheelEvent): void {
  if (event.deltaY >= 0 || settlingSession || adjustingWindow) return;
  const sc = scroller.value;
  if (!sc || sc.scrollTop <= 0) return;
  suppressFollowBottomUntil = 0;
  userScrolledAway = true;
  followBottom = false;
  cancelQueuedBottomSnaps();
  showJumpLatest.value = displayMessages.value.length > 0;
}

/** Heavy virtual-window / prefetch work stays rAF-coalesced (follow already synced). */
function handleScrollerScroll(): void {
  const sc = scroller.value;
  if (!sc || adjustingWindow || settlingSession) return;

  if (followBottom) {
    const len = displayMessages.value.length;
    const ideal = followBottomVirtualWindow(len, VIRTUAL_WINDOW);
    if (renderStart.value !== ideal.start || renderEnd.value !== ideal.end) {
      renderStart.value = ideal.start;
      renderEnd.value = ideal.end;
    }
    return;
  }

  // Prefetch above: expand before the viewport hits blank spacer.
  if (sc.scrollTop < topSpacerPx.value + OVERSCAN_PX) {
    expandHistoryUp();
  }
  // Prefetch below: keep continuity when scrolling back toward latest.
  const bottomEdge = sc.scrollHeight - bottomSpacerPx.value;
  if (sc.scrollTop + sc.clientHeight > bottomEdge - OVERSCAN_PX) {
    expandHistoryDown();
  }
}

function onScrollerScroll(): void {
  const sc = scroller.value;
  if (sc) syncFollowBottomOnScroll(sc);
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    handleScrollerScroll();
    updateStickyPinned();
  });
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
    // loadOlderHistoryPage owns index shifts while prepending; skip to avoid double-clamp.
    if (loadingOlderPage) return;
    const hydratedFromEmpty = (prevLen === 0 || prevLen == null) && len > 0;
    // Only pin the trailing window when the user is following the bottom.
    // (Do NOT yank the window during agent runs if the user scrolled up to read history.)
    if (followBottom || hydratedFromEmpty) {
      clampRenderWindow(true);
    } else if (len <= VIRTUAL_WINDOW) {
      renderStart.value = 0;
      renderEnd.value = len;
    } else {
      // Prepend path adjusts indices inside loadOlderHistoryPage before length settles.
      clampRenderWindow(false);
    }
    // Critical: hydrate often lands AFTER settle timeouts. Always snap when
    // following bottom / first populate, otherwise the virtual spacer stays in view (blank).
    // Skip while hidden — the visibility handler re-snaps once on restore.
    if ((followBottom || settlingSession || hydratedFromEmpty) && !document.hidden) {
      lastPinnedUserId = latestUserMessageId.value;
      showJumpLatest.value = false;
      void nextTick(() => {
        // User may have scrolled up while this tick was queued — respect it.
        if (!followBottom && !settlingSession && !hydratedFromEmpty) return;
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
    void nextTick(() => {
      if (!followBottom && !settlingSession) return;
      jumpToBottomInstant();
    });
  },
);

/** When a new latest user message appears (send / re-edit send): leave room for agent. */
watch(
  () => latestUserMessageId.value,
  async (id) => {
    stickyExpanded.value = false;
    stickyHover.value = false;
    stickyNeedsToggle.value = false;
    stickyPinId.value = null;
    if (!id || id === lastPinnedUserId) {
      updateStickyPinned();
      refreshStickyToggleNeed();
      return;
    }
    lastPinnedUserId = id;
    followBottom = true;
    userScrolledAway = false;
    clampRenderWindow(true);
    // Session switch / hydrate: land on bottom instantly (no slide).
    if (settlingSession) {
      await nextTick();
      jumpToBottomInstant();
      updateStickyPinned();
      refreshStickyToggleNeed();
      return;
    }
    // Brief pause so follow-bottom doesn't yank away before layout settles.
    suppressFollowBottomUntil = Date.now() + 160;
    await nextTick();
    measureVisibleRows();
    updateStickyPinned();
    refreshStickyToggleNeed();
    const sc = scroller.value;
    const card = sc?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!sc || !card) return;
    // Show the end of the full prompt (no height clamp until actually pinned).
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
    if (document.hidden) return;
    await nextTick();
    const el = scroller.value;
    if (!el) return;
    const prevStreaming = prev?.[1] ?? null;
    const prevRunning = prev?.[2] ?? false;
    const justFinished =
      Boolean(prevRunning || prevStreaming) && !running && !streaming;
    // Follow while generating; also snap once when the turn settles (actions
    // mount) — but never yank a user who scrolled up to read history.
    if (running || streaming || justFinished) {
      if (!followBottom) return;
      // Coalesced + re-checked at fire time (never yanks a scrolled-up reader).
      scheduleBottomScroll();
      measureVisibleRows();
      if (justFinished) {
        requestAnimationFrame(() => {
          const sc = scroller.value;
          if (sc && followBottom) sc.scrollTop = sc.scrollHeight;
        });
      }
    }
  },
);

let lastStreamToolId = "";
let lastStreamArgs: unknown;
let lastStreamResult: unknown;
/** Thinking / tool body growth often keeps the same message id — still pin to bottom. */
watch(
  () => {
    const s = props.streaming;
    if (!s) return "";
    if (s.role === "assistant") {
      lastStreamToolId = "";
      lastStreamArgs = undefined;
      lastStreamResult = undefined;
      return `a:${s.thinking?.length ?? 0}:${s.text?.length ?? 0}`;
    }
    if (s.role === "tool") {
      // Every streamed update replaces the args/result objects, so identity is
      // enough — avoids JSON.stringify(args/result) on every chunk (O(output)
      // stringify per tick while a bash/write tool streams).
      const changed =
        s.id !== lastStreamToolId || s.args !== lastStreamArgs || s.result !== lastStreamResult;
      lastStreamToolId = s.id;
      lastStreamArgs = s.args;
      lastStreamResult = s.result;
      return `t:${s.id}:${changed ? "1" : "0"}`;
    }
    lastStreamToolId = "";
    lastStreamArgs = undefined;
    lastStreamResult = undefined;
    return s.id;
  },
  async () => {
    if (!followBottom || Date.now() < suppressFollowBottomUntil) return;
    if (!props.running && !props.streaming) return;
    if (document.hidden) return;
    await nextTick();
    scheduleBottomScroll();
  },
);

onMounted(() => {
  const sc = scroller.value;
  sc?.addEventListener("scroll", onScrollerScroll, { passive: true });
  sc?.addEventListener("wheel", onScrollerWheel, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  // Auto-load on startup mounts MessageList *after* activeId is set, so the
  // sessionId watcher may not re-fire — settle here or the spacer looks blank.
  void beginSessionSettle();
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener("scroll", onScrollerScroll);
  scroller.value?.removeEventListener("wheel", onScrollerWheel);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
  if (bottomScrollRaf) {
    cancelAnimationFrame(bottomScrollRaf);
    bottomScrollRaf = 0;
  }
  instantSnapToken++;
});

/**
 * The current round finished (nothing streaming and nothing running): fold all
 * process rows (tools + thinking) so only the user question and final answer
 * stay prominent, Codex-style. Users can still re-expand any row manually.
 */
const turnDone = computed(() => !props.running && !props.streaming);

/** A tool group is still live while any member tool is streaming. */
function toolGroupStreaming(msg: ToolMessage): boolean {
  return (
    toolGroupMembership.value.get(msg.id)?.tools.some((t) => t.streaming) ?? false
  );
}

/**
 * Memoize card parsing: the same message object never re-parses its diff.
 * Write/edit diff synthesis is O(file size) and used to run again on every
 * unrelated re-render (other tool streams, phase-clock ticks, status flips),
 * which starved the UI thread while an agent ran bash / edited large files.
 */
const toolCardCache = new WeakMap<Extract<ChatMessage, { role: "tool" }>, ToolCard>();
function toolCard(msg: Extract<ChatMessage, { role: "tool" }>): ToolCard {
  let card = toolCardCache.get(msg);
  if (!card) {
    card = parseToolCard(msg.toolName, msg.args, msg.result, { isError: msg.isError });
    toolCardCache.set(msg, card);
  }
  return card;
}

function isModeTagKind(kind: string | undefined): boolean {
  return isComposerAgentMode(kind);
}

function visibleUserTags(
  tags:
    | {
        url: string;
        host: string;
        label: string;
        content?: string;
        kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
      }[]
    | undefined,
) {
  return (tags ?? []).filter((tag) => !isModeTagKind(tag.kind));
}

function displayUserText(text: string): string {
  return stripComposerModePreamble(text);
}

/** Long user cards get a fold toggle (line-clamp when collapsed). */
function userCardNeedsToggle(msg: Extract<ChatMessage, { role: "user" }>): boolean {
  const textLen = displayUserText(msg.text).length;
  const imgCount = msg.images?.length ?? 0;
  const tagCount = visibleUserTags(msg.elementTags).length;
  return textLen > 140 || imgCount > 2 || tagCount > 4;
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

function isSpeakingMessage(id: string): boolean {
  return tts.speakingMessageId === id && tts.status.speaking;
}

/**
 * "12.4s · 1.2k tok · 96 tok/s" for a finished assistant turn.
 * Shows when we have duration and/or usage from the final message.
 */
function assistantStats(
  msg: Extract<ChatMessage, { role: "assistant" }>,
): { compact: string; detail: string } | null {
  const durMs = msg.durationMs;
  const usage = msg.usage;
  const total = usage?.totalTokens;
  const durLabel = durMs != null && durMs > 0 ? formatElapsedMs(durMs) : null;
  const tokLabel =
    total != null && total > 0 ? formatTokenCount(total) : null;
  if (!durLabel && !tokLabel) return null;

  const perSec =
    durLabel && tokLabel && durMs && durMs > 0 && total && total > 0
      ? Math.round(total / (durMs / 1000))
      : null;
  const compact = [durLabel, tokLabel, perSec != null ? `${perSec}/s` : null]
    .filter(Boolean)
    .join(" · ");
  const detail = t.assistantStatsTitle(
    durLabel ?? "—",
    total != null ? total.toLocaleString() : "—",
    perSec != null ? String(perSec) : "—",
  );
  return { compact, detail };
}

function formatElapsedMs(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return rem ? `${min}m ${rem}s` : `${min}m`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

async function onSpeakMessage(msgId: string, text: string): Promise<void> {
  if (!text?.trim()) return;

  if (isSpeakingMessage(msgId)) {
    await tts.stopSpeak();
    return;
  }

  await tts.refresh();
  if (!tts.status.supported) {
    messageApi.warning(t.ttsUnsupported);
    return;
  }
  if (!tts.status.installed) {
    const mb = tts.status.voiceDiskMb + tts.status.runtimeDiskMb;
    dialog.warning({
      title: t.ttsInstall,
      content: `${t.ttsNeedInstall}\n\n${t.ttsInstallConfirm(mb)}`,
      positiveText: t.ttsInstall,
      negativeText: t.cancel,
      onPositiveClick: async () => {
        try {
          await tts.install();
          messageApi.success(t.ttsInstallOk);
          await tts.speakManual(msgId, text);
        } catch (err) {
          messageApi.error(err instanceof Error ? err.message : t.ttsNotInstalled);
        }
      },
    });
    return;
  }

  await tts.speakManual(msgId, text);
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
  composer.draft = displayUserText(edited.text);
  for (const img of edited.images ?? []) {
    composer.addImageFromDataUrl(img.dataUrl);
  }
  for (const tag of visibleUserTags(edited.elementTags)) {
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
  const d = dialog.warning({
    title: t.revertTurn,
    content: t.revertTurnConfirm,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return (async () => {
        try {
          const result = await checkpoints.revert(id, msg.id);
          if (!result.ok) {
            messageApi.error(t.revertTurnFail(result.error || "unknown"));
            d.loading = false;
            return false;
          }
          if (result.restored === 0 && result.deleted === 0) {
            messageApi.info(t.revertTurnEmpty);
            return;
          }
          messageApi.success(t.revertTurnDone(result.restored, result.deleted));
        } catch (err) {
          messageApi.error(err instanceof Error ? err.message : String(err));
          d.loading = false;
          return false;
        }
      })();
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
        v-if="historyLoadingOlder || (historyHasMore && renderStart === 0 && topSpacerPx < 8)"
        class="history-older-banner"
        aria-live="polite"
      >
        {{ historyLoadingOlder ? t.loadingOlderHistory : t.scrollForOlderHistory }}
      </div>

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
          toolGroupMembership.get(msg.id)?.isLead === false ? 'row-tool-group-follower' : '',
          sessionId && chat.isPendingEditTail(sessionId, msg.id) ? 'row-edit-tail' : '',
        ]"
        :data-msg-id="msg.id"
      >
        <template v-if="msg.role === 'user'">
          <div class="bubble-wrap user">
            <div
              class="bubble user"
              :class="{ 'user-collapsed': !isUserExpanded(msg.id) }"
            >
              <div v-if="msg.images?.length" class="user-images">
                <img
                  v-for="(img, idx) in msg.images"
                  :key="`${msg.id}-img-${idx}`"
                  class="user-image"
                  :src="img.dataUrl"
                  :alt="t.imageAttachment"
                  loading="lazy"
                  draggable="false"
                  @click.stop="openImagePreview(img)"
                />
              </div>
              <div
                v-if="displayUserText(msg.text)"
                class="user-plain"
                :class="{ clamped: !isUserExpanded(msg.id) }"
              >{{ displayUserText(msg.text) }}</div>
              <div v-if="visibleUserTags(msg.elementTags).length" class="user-tags">
                <NTag
                  v-for="(tag, idx) in visibleUserTags(msg.elementTags)"
                  :key="`${msg.id}-tag-${idx}`"
                  type="info"
                  size="small"
                  round
                  class="user-tag"
                  :class="{
                    'user-tag-file': tag.kind === 'file',
                  }"
                  :title="tag.url || tag.label"
                >
                  {{ tag.label || tag.content }}
                </NTag>
              </div>
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
              <button
                v-if="userCardNeedsToggle(msg)"
                type="button"
                class="user-card-toggle"
                :aria-expanded="isUserExpanded(msg.id)"
                @click.stop="toggleUserExpanded(msg.id)"
              >
                <NIcon
                  :component="isUserExpanded(msg.id) ? ChevronUpOutline : ChevronDownOutline"
                  :size="13"
                />
                <span>{{ isUserExpanded(msg.id) ? t.userCardCollapse : t.userCardExpand }}</span>
              </button>
            </div>
            <div v-if="!running" class="actions user-actions">
              <NTooltip>
                <template #trigger>
                  <NButton quaternary circle size="tiny" @click="copyText(displayUserText(msg.text))">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                  </NButton>
                </template>
                {{ t.copy }}
              </NTooltip>
              <NTooltip v-if="msg.text">
                <template #trigger>
                  <NButton
                    quaternary
                    circle
                    size="tiny"
                    @click="onSpeakMessage(msg.id, msg.text)"
                  >
                    <template #icon>
                      <NIcon
                        :component="isSpeakingMessage(msg.id) ? PauseOutline : VolumeMediumOutline"
                      />
                    </template>
                  </NButton>
                </template>
                {{ isSpeakingMessage(msg.id) ? t.ttsStopSpeak : t.ttsSpeak }}
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
            <div
              class="bubble assistant"
              :class="{ 'think-bottom': msg.streaming && msg.thinking && !msg.text }"
            >
              <ThinkingBlock
                v-if="msg.thinking || (msg.streaming && !msg.text)"
                :thinking="msg.thinking ?? ''"
                :streaming="Boolean(msg.streaming && !msg.text)"
                :started-at="msg.thinkingStartedAt"
                :duration-ms="msg.thinkingDurationMs"
                :auto-collapse="turnDone || !(msg.streaming && !msg.text)"
              />
              <MarkdownView
                v-if="msg.text"
                :content="msg.text"
                class="assistant-md"
                :class="{ 'stream-shimmer': msg.streaming && msg.text }"
              />
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
              <NTooltip v-if="msg.text">
                <template #trigger>
                  <NButton
                    quaternary
                    circle
                    size="tiny"
                    @click="onSpeakMessage(msg.id, msg.text)"
                  >
                    <template #icon>
                      <NIcon
                        :component="isSpeakingMessage(msg.id) ? PauseOutline : VolumeMediumOutline"
                      />
                    </template>
                  </NButton>
                </template>
                {{ isSpeakingMessage(msg.id) ? t.ttsStopSpeak : t.ttsSpeak }}
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
              <span
                v-if="assistantStats(msg)"
                class="assistant-stats"
                :title="assistantStats(msg)!.detail"
              >
                {{ assistantStats(msg)!.compact }}
              </span>
            </div>
          </div>
        </template>

        <template v-else-if="msg.role === 'tool'">
          <div v-if="isProcessSummary(msg)" class="tool process-summary-row">
            <button
              type="button"
              class="process-summary pi-interactive"
              :title="msg.args?.expanded ? t.processCollapse : t.processExpand"
              @click="msg.args?.expanded ? (workFolded = true) : (workFolded = false)"
            >
              <span class="ps-dot" aria-hidden="true" />
              <span class="ps-label">{{ processSummaryLabel(msg) }}</span>
              <NIcon
                :component="msg.args?.expanded ? ChevronUpOutline : ChevronDownOutline"
                :size="14"
                class="ps-chevron"
              />
            </button>
          </div>
          <div v-else-if="toolGroupMembership.get(msg.id)?.isLead" class="tool">
            <ToolCallGroup
              :tools="toolGroupMembership.get(msg.id)!.tools"
              :auto-collapse="turnDone || !toolGroupStreaming(msg)"
              @open="openPreview"
            />
          </div>
          <div v-else-if="!toolGroupMembership.has(msg.id)" class="tool">
            <ToolCallCard
              :card="toolCard(msg)"
              :tool-name="msg.toolName"
              :order="msg.order"
              :status-label="toolStatus(msg).label"
              :status-type="toolStatus(msg).type"
              :streaming="msg.streaming"
              :auto-collapse="turnDone || !msg.streaming"
              @open="openPreview"
            />
          </div>
        </template>

        <template v-else-if="msg.role === 'error'">
          <div
            class="bubble-wrap"
            :class="msg.variant === 'cancelled' ? 'cancelled-wrap' : 'error-wrap'"
          >
            <div
              class="bubble"
              :class="msg.variant === 'cancelled' ? 'cancelled' : 'error'"
            >
              {{ msg.text }}
            </div>
            <NButton
              size="tiny"
              :quaternary="msg.variant === 'cancelled'"
              :secondary="msg.variant !== 'cancelled'"
              :type="msg.variant === 'cancelled' ? 'default' : 'primary'"
              :disabled="running"
              class="error-retry-btn"
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

      <div
        v-if="bottomSpacerPx > 0"
        class="virtual-spacer"
        :style="{ height: `${bottomSpacerPx}px` }"
        aria-hidden="true"
      />

      <template v-if="renderEnd >= displayMessages.length">
        <div v-if="retryHint" class="running-indicator retry">
          <span class="dot warn" />
          <NText depth="3" style="font-size: 12px">
            {{ t.retrying(retryHint.attempt, retryHint.maxAttempts) }}
            <span v-if="retryHint.message" class="retry-detail"> · {{ retryHint.message }}</span>
          </NText>
        </div>
        <AgentWaitIndicator
          v-else-if="waitState && (showWaitWhileStreaming || !streaming)"
          :state="waitState"
        />
      </template>
    </div>
    </div>

    <div
      v-if="stickyPinned && stickyPinMessage"
      ref="stickyPinEl"
      class="user-sticky-pin"
      :class="{ 'is-expanded': stickyExpanded }"
      @mouseenter="onStickyUserEnter"
      @mouseleave="onStickyUserLeave"
    >
      <div
        class="sticky-pin-body bubble user"
        :class="{ 'user-collapsed': !stickyExpanded && userCardNeedsToggle(stickyPinMessage) }"
      >
        <div v-if="stickyPinMessage.images?.length" class="user-images">
          <img
            v-for="(img, idx) in stickyPinMessage.images"
            :key="`pin-img-${idx}`"
            class="user-image"
            :src="img.dataUrl"
            :alt="t.imageAttachment"
            loading="lazy"
            draggable="false"
            @click.stop="openImagePreview(img)"
          />
        </div>
        <div
          v-if="displayUserText(stickyPinMessage.text)"
          class="user-plain"
          :class="{ clamped: !stickyExpanded && userCardNeedsToggle(stickyPinMessage) }"
        >{{ displayUserText(stickyPinMessage.text) }}</div>
        <div v-if="visibleUserTags(stickyPinMessage.elementTags).length" class="user-tags">
          <NTag
            v-for="(tag, idx) in visibleUserTags(stickyPinMessage.elementTags)"
            :key="`pin-tag-${idx}`"
            type="info"
            size="small"
            round
            class="user-tag"
            :class="{
              'user-tag-file': tag.kind === 'file',
            }"
            :title="tag.url || tag.label"
          >
            {{ tag.label || tag.content }}
          </NTag>
        </div>
      </div>
      <button
        v-if="stickyNeedsToggle && (stickyHover || stickyExpanded)"
        type="button"
        class="sticky-toggle"
        :aria-expanded="stickyExpanded"
        :aria-label="stickyExpanded ? t.stickyCollapse : t.stickyExpand"
        @click.stop="toggleStickyExpanded"
      >
        <NIcon
          :component="stickyExpanded ? ChevronUpOutline : ChevronDownOutline"
          :size="14"
        />
        <span>{{ stickyExpanded ? t.stickyCollapse : t.stickyExpand }}</span>
      </button>
    </div>

    <Transition name="jump-latest">
      <button
        v-if="showJumpLatest && !settlingUi && !historyLoading"
        type="button"
        class="jump-latest pi-interactive"
        :title="t.scrollToLatest"
        :aria-label="t.scrollToLatest"
        @click="jumpToLatest"
      >
        <NIcon :component="ArrowDownOutline" :size="16" />
        <span>{{ t.scrollToLatest }}</span>
      </button>
    </Transition>
  </div>
  <!-- Image lightbox: click to zoom, right-click to copy / save. -->
  <Teleport to="body">
    <div
      v-if="imagePreview"
      class="image-preview-overlay"
      tabindex="-1"
      @keydown="onPreviewKeydown"
      @click.self="closeImagePreview"
      @contextmenu.self.prevent="closeImagePreview"
    >
      <div class="preview-toolbar">
        <span class="preview-title">{{ t.imageAttachment }}</span>
        <div class="preview-actions">
          <button type="button" class="preview-btn" @click="copyPreviewImage">
            {{ t.copyImage }}
          </button>
          <button type="button" class="preview-btn" @click="savePreviewImage">
            {{ t.saveImage }}
          </button>
          <button
            type="button"
            class="preview-btn close"
            :aria-label="t.close"
            :title="t.close"
            @click="closeImagePreview"
          >
            ✕
          </button>
        </div>
      </div>
      <img
        :src="imagePreview?.dataUrl"
        class="preview-img"
        alt=""
        @contextmenu.prevent="openPreviewMenu"
      />
      <div
        v-if="previewMenuOpen"
        class="preview-context-menu"
        :style="{ left: previewMenuPos.x + 'px', top: previewMenuPos.y + 'px' }"
        @contextmenu.prevent
      >
        <button type="button" class="ctx-item" @click="copyPreviewImage">
          {{ t.copyImage }}
        </button>
        <button type="button" class="ctx-item" @click="savePreviewImage">
          {{ t.saveImage }}
        </button>
      </div>
    </div>
  </Teleport>
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

.history-older-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 6px 10px;
  font-size: 11px;
  color: var(--fg-muted, #888);
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
  max-width: var(--composer-max, 780px);
  margin: 0 auto;
  padding: 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 100%;
  box-sizing: border-box;
}

.virtual-spacer {
  flex-shrink: 0;
  width: 100%;
  pointer-events: none;
}

.jump-latest {
  position: absolute;
  left: 50%;
  bottom: 14px;
  z-index: 8;
  /* Independent of transform/scale press feedback — keeps hit target stable. */
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 80%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-panel, var(--bg)) 92%, transparent);
  color: var(--fg, #222);
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(8px);
  cursor: pointer;
}

.jump-latest:hover {
  background: var(--bg-panel, var(--bg));
}

.jump-latest-enter-active,
.jump-latest-leave-active {
  transition:
    opacity 160ms ease,
    translate 160ms ease;
}

.jump-latest-enter-from,
.jump-latest-leave-to {
  opacity: 0;
  translate: -50% 8px;
}

.row {
  display: flex;
}

/* DeepSeek Harness: a single uniform column gap spaces every flow item. */
.row-user {
  justify-content: flex-end;
  width: 100%;
}

.row-assistant {
  /* spacing handled by .inner gap */
}

/* DeepSeek Harness renders tool calls inline as flow items — no indentation,
   no left rail; spacing comes from the column gap alone. */
.row-tool {
  margin: 0;
  padding-left: 0;
  border-left: none;
}

.row-tool.process-summary-row {
  padding-left: 0;
  border-left: none;
}

.row-error {
  margin: 4px 0;
}

/* Only the last row of the stream adds bottom padding; the gap already
   separates — avoid double spacing before the composer. */
.row:last-child {
  margin-bottom: 4px;
}
.user-sticky-pin {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 6;
  display: flex;
  justify-content: flex-end;
  max-height: min(16vh, 110px);
  overflow: hidden;
  background: var(--bg);
  padding: 6px var(--chat-pad-x, 10px) 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #ddd) 55%, transparent);
  box-shadow: 0 4px 12px color-mix(in srgb, #000 6%, transparent);
  transition: max-height 0.18s ease;
}

.user-sticky-pin.is-expanded {
  max-height: min(40vh, 280px);
  overflow-y: auto;
}

.user-sticky-pin::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 36px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--bg));
  transition: opacity 0.15s ease;
}

.user-sticky-pin.is-expanded::after {
  opacity: 0;
}

.sticky-pin-body {
  width: auto;
  max-width: min(85%, 640px);
  margin-left: auto;
}

.sticky-toggle {
  position: absolute;
  left: 50%;
  bottom: 6px;
  z-index: 2;
  translate: -50% 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--border, #ddd) 70%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg) 92%, var(--fg, #111) 8%);
  color: var(--fg-secondary, var(--fg, #666));
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  box-shadow: 0 1px 4px color-mix(in srgb, #000 12%, transparent);
}

.sticky-toggle:hover {
  color: var(--fg, #111);
  border-color: color-mix(in srgb, var(--border, #ddd) 100%, transparent);
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

/* Folded into ToolCallGroup on the lead row — keep DOM for virtual ids, zero layout. */
.row-tool-group-follower {
  display: none;
}

.bubble-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 100%;
}

.bubble-wrap.user {
  align-items: flex-end;
  width: auto;
  max-width: min(82%, 525px);
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

.bubble-wrap.cancelled-wrap {
  align-items: center;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 6px 10px;
  max-width: 100%;
  margin: 4px 0 2px;
}

.bubble {
  padding: 9px 13px;
  border-radius: var(--radius-md, 11px);
  font-size: 16px;
  line-height: 1.6;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

/* User prompt: DeepSeek-style soft blue pill, right-aligned, no border. */
.bubble.user {
  width: auto;
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px 16px;
  border-radius: 22px;
  background: var(--user-bg, #edf3fe);
  color: var(--fg-strong);
  border: none;
  box-shadow: none;
  overflow: hidden;
}

/* Collapsed long card: clamp the text block to a few lines. */
.bubble.user.user-collapsed .user-plain {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.user-card-toggle {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 6px;
  padding: 1px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--accent, #3b82f6);
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
}

.user-card-toggle:hover {
  background: color-mix(in srgb, var(--accent, #3b82f6) 12%, transparent);
}

.bubble.assistant {
  background: transparent;
  padding: 2px 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 16px;
  line-height: 1.75;
  color: var(--fg, #0f1115);
}

/* The final answer is the visual anchor of an assistant message — give the
   markdown body room below the (folded) thinking block and above the actions. */
.bubble.assistant :deep(.assistant-md) {
  margin-top: 4px;
}

.bubble.assistant :deep(.assistant-md:first-child) {
  margin-top: 0;
}

/* While thinking with no answer yet: pin the thinking block to the bottom
   so it follows the "live" edge as thinking text grows. */
.bubble.assistant.think-bottom {
  flex-direction: column-reverse;
}

.bubble.assistant.think-bottom .markdown-view {
  margin-top: 0;
  margin-bottom: 0;
}

.bubble.error {
  background: rgba(208, 48, 80, 0.08);
  border: 1px solid rgba(208, 48, 80, 0.35);
  color: var(--fg-strong);
}

/* Cursor-like stop notice: muted inline text, no alarm card. */
.bubble.cancelled {
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--fg-muted, #888);
  font-style: italic;
}

.error-retry-btn {
  flex-shrink: 0;
}

.cancelled-wrap .error-retry-btn {
  --n-height: 22px !important;
  --n-font-size: 12px !important;
  --n-padding: 0 6px !important;
  color: var(--fg-muted, #888) !important;
}

.cancelled-wrap .error-retry-btn:hover {
  color: var(--fg-strong, #222) !important;
}

.user-tags,
.user-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
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
  object-fit: cover;
  cursor: zoom-in;
  border: 1px solid var(--border);
  transition: filter var(--duration-fast, 140ms) var(--ease-out, ease);
}

.user-image:hover {
  filter: brightness(0.94);
}

.user-plain {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 16px;
  line-height: 1.5;
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

/* DeepSeek Harness MessageIconActions: 28px circular, label-tertiary,
   hover → interactive-bg-hover + label-secondary. */
.actions :deep(.n-button) {
  width: 28px;
  height: 28px;
  color: var(--fg-faint, #81858c) !important;
}

.actions :deep(.n-button:hover:not(.n-button--disabled)) {
  background: var(--bg-hover, #f1f3f5) !important;
  color: var(--fg-muted, #61666b) !important;
}

/* Copy / re-edit under the prompt (hover). Revert is inside the bubble. */
.user-actions {
  justify-content: flex-end;
  margin-top: 2px;
  padding-right: 2px;
}

.bubble-wrap:hover .actions {
  opacity: 1;
}

/* Turn stats (duration · tokens · tok/s) — muted, right side of the actions. */
.assistant-stats {
  margin-left: 8px;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-faint, var(--fg-muted));
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
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

/*
 * Streaming answer: a soft highlight sweeps across the text to show the
 * model is still producing output (Cursor-style shimmer). A translucent
 * gradient bar sweeps over the block — text colours are left untouched so
 * markdown (code, links) stays readable.
 */
.stream-shimmer {
  position: relative;
  border-radius: 3px;
}

.stream-shimmer::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(
    100deg,
    transparent 30%,
    color-mix(in srgb, var(--accent, #2563eb) 14%, transparent) 48%,
    color-mix(in srgb, var(--accent, #2563eb) 14%, transparent) 52%,
    transparent 70%
  );
  background-repeat: no-repeat;
  background-size: 55% 100%;
  animation: stream-sweep 1.6s ease-in-out infinite;
}

@keyframes stream-sweep {
  from {
    background-position: -60% 0;
  }
  to {
    background-position: 170% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .stream-shimmer::after {
    animation: none;
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

/* Image lightbox */
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483644;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(9, 9, 11, 0.82);
  backdrop-filter: blur(3px);
  cursor: zoom-out;
  animation: preview-fade 160ms var(--ease-out, ease);
  outline: none;
}

@keyframes preview-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preview-toolbar {
  position: absolute;
  top: 12px;
  left: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(24, 24, 27, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #fafafa;
  user-select: none;
}

.preview-title {
  font-size: 12.5px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-btn {
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fafafa;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.preview-btn:hover {
  background: rgba(255, 255, 255, 0.18);
}

.preview-btn.close {
  border-color: transparent;
  background: transparent;
  font-size: 14px;
  padding: 4px 8px;
}

.preview-img {
  max-width: calc(100vw - 80px);
  max-height: calc(100vh - 80px);
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  cursor: zoom-out;
  user-select: none;
  -webkit-user-drag: none;
}

.preview-context-menu {
  position: fixed;
  z-index: 2147483645;
  min-width: 150px;
  padding: 4px;
  border-radius: 10px;
  background: var(--bg-elevated, #1c1c22);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg, 0 12px 40px rgba(0, 0, 0, 0.3));
  animation: preview-fade 100ms var(--ease-out, ease);
}

.ctx-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--fg);
  text-align: left;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.ctx-item:hover {
  background: var(--bg-hover);
}

@media (prefers-reduced-motion: reduce) {
  .image-preview-overlay {
    animation: none;
  }
}

/* One-big-group process summary after the final answer — plain text row */
.process-summary-row {
  padding: 0 4px 2px;
}

.process-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  transition: background var(--duration-fast, 140ms) var(--ease-out, ease);
}

.process-summary:hover {
  background: color-mix(in srgb, var(--fg) 4%, transparent);
  color: var(--fg);
}

.ps-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.ps-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ps-chevron {
  flex-shrink: 0;
  color: var(--fg-faint, var(--fg-muted));
  transition: transform var(--duration-fast, 140ms) var(--ease-out, ease);
}
</style>
