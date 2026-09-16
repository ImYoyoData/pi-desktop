<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  NButton,
  NEmpty,
  NIcon,
  NTag,
  NText,
  NTooltip,
  useDialog,
  useMessage,
} from "naive-ui";
import { ArrowDownOutline, ArrowUndoOutline, ChevronDownOutline, ChevronUpOutline, CopyOutline, CreateOutline, GitBranchOutline, PauseOutline, RefreshOutline, VolumeMediumOutline } from "@vicons/ionicons5";
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
import TurnDiffSummary from "@renderer/components/TurnDiffSummary.vue";
import WorkSectionGroup from "@renderer/components/WorkSectionGroup.vue";
import AgentWaitIndicator from "@renderer/components/AgentWaitIndicator.vue";
import { toolCardFor as toolCard } from "@renderer/utils/tool-diff";
import {
  buildWorkSectionSpans,
  finalAnswerRowIds,
} from "@renderer/utils/tool-group";
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
  collectTurnFileChanges,
  type TurnFileChanges,
} from "@renderer/utils/turn-file-changes";
import { decideFollowOnScroll } from "@renderer/utils/follow-bottom";
import { thinkingLevelLabel } from "@renderer/utils/thinking-level";

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
  /** 面板被折叠/让位给编辑器区域时为 false。 */
  visible?: boolean;
}>();

/** 面板不可见时内容会被跳过渲染，任何读量高都会强制布局，必须停掉追踪。 */
function paneHidden(): boolean {
  return props.visible === false;
}

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

/**
 * Queued sends still waiting for their turn, shown as cards at the tail so the
 * message never appears to vanish while the agent finishes what it is doing.
 */
const pendingQueueCards = computed(() => sendQueue.activeItems);

/** One-line preview for a queued card (mirrors SendQueueBar). */
function queuePreview(item: { text: string; images?: unknown[]; elementTags?: { label?: string }[] }): string {
  const raw = item.text.replace(/\s+/gu, " ").trim();
  if (raw) return raw;
  if (item.images?.length) return `[${item.images.length} image(s)]`;
  if (item.elementTags?.length) return item.elementTags[0]?.label || "[attachment]";
  return "…";
}
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
/** Heights are session-scoped: switching sessions keeps past measurements usable. */
function heightKey(id: string): string {
  return `${sessions.activeId}|${id}`;
}
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
/**
 * Hard latch: the user is reading history and may be away from the live edge —
 * absolutely no viewport motion until they ask for it. Guards every watcher /
 * mutation that would otherwise snap back to the bottom while the agent keeps
 * streaming or while older pages keep loading.
 */
let readingHistory = false;
/** Session switch / hydrate settle — snap to bottom, never smooth-scroll. */
let settlingSession = false;
let sessionJumpToken = 0;
/** Template flag: hide list until first bottom snap (avoids blank spacer flash). */
const settlingUi = ref(false);
/** Show floating jump control when user scrolled away from latest. */
const showJumpLatest = ref(false);
let scrollRaf = 0;

/**
 * VS Code Copilot design (chatThinkingContentPart): the latest turn's process
 * — every tool call and thinking row between answer texts — stays in the
 * stream, folded per work section (see WorkSectionGroup). Older turns drop
 * their process rows so history reads as prompts + final answers only.
 */
const latestTurnStart = computed(() => {
  const list = props.messages;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") return i;
  }
  return -1;
});

/** Tool rows that must stay visible even in clean history (user questions). */
function isKeepVisibleTool(msg: ChatMessage): boolean {
  return msg.role === "tool" && msg.toolName === ASK_USER_TOOL_NAME;
}

/** 完整消息序列（含 streaming）：改动统计需要历史轮被裁剪掉的工具行。 */
const allMessages = computed<ChatMessage[]>(() => {
  const list = [...props.messages];
  if (props.streaming) list.push(props.streaming);
  return list;
});

const displayMessages = computed(() => {
  const list = allMessages.value;
  const start = latestTurnStart.value;
  const out: ChatMessage[] = [];
  for (let i = 0; i < list.length; i++) {
    const msg = list[i]!;
    // Older, already-finished turns: drop their tool/thinking rows so the
    // history reads as user messages + final answers only (Codex-like).
    // Interactive ask_user rows stay visible.
    if (
      i <= start &&
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

type WorkSectionMembership = {
  groupId: string;
  leadId: string;
  isLead: boolean;
  items: ChatMessage[];
};

/**
 * Copilot work sections: consecutive process rows (all tool calls + thinking
 * rows between answer texts) fold into one collapsible WorkSectionGroup.
 * Interactive ask_user tools break the section and stay standalone.
 */
const workSectionMembership = computed(() => {
  const all = displayMessages.value;
  const map = new Map<string, WorkSectionMembership>();
  const spans = buildWorkSectionSpans(
    all.map((m) => ({
      id: m.id,
      role: m.role,
      toolName: m.role === "tool" ? m.toolName : "",
      hasText: m.role === "assistant" ? Boolean(m.text) : false,
      hasThinking: m.role === "assistant" ? Boolean(m.thinking) : false,
    })),
    (row) => row.toolName === ASK_USER_TOOL_NAME,
  );
  for (const span of spans) {
    const items = all.slice(span.start, span.end);
    for (let i = 0; i < span.ids.length; i++) {
      map.set(span.ids[i]!, {
        groupId: span.groupId,
        leadId: span.ids[0]!,
        isLead: i === 0,
        items,
      });
    }
  }
  return map;
});

/**
 * Copilot fold rule (chatProgressContentPart `isHidden`): a process block
 * folds only once visible output actually renders AFTER it in the stream —
 * an assistant answer text, or a newer process row (the next section/tool).
 * Rows fold in strict appearance order: an earlier block never stays open
 * past a later one that already folded, and nothing folds on a bare agent
 * response that produced no visible output.
 *
 * Computed in ONE backward pass (O(n)) — this recomputes on every streaming
 * tick, so it must stay cheap or long turns would jank.
 */
const settledRowIds = computed(() => {
  const all = displayMessages.value;
  const membership = workSectionMembership.value;
  const settled = new Set<string>();
  // Track for each message whether anything visible appears after it.
  // Backward pass: "has later visible output" propagates from the end.
  const n = all.length;
  const isProcessRow = (m: ChatMessage): boolean =>
    m.role === "tool" ||
    (m.role === "assistant" && Boolean(m.thinking) && !m.text);
  const isVisible = (m: ChatMessage): boolean =>
    m.role === "assistant" && Boolean(m.text) ? true : isProcessRow(m);
  // hasVisibleAfter[i] = any visible row in (i, n).
  const hasVisibleAfter = new Array<boolean>(n + 1).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    hasVisibleAfter[i] = hasVisibleAfter[i + 1] || isVisible(all[i]!);
  }
  // A group settles as a unit once ANY row past its last member is visible.
  // Compute per-group end boundary once (id→index map keeps this O(n)).
  const indexById = new Map<string, number>();
  for (let i = 0; i < n; i++) indexById.set(all[i]!.id, i);
  const groupEndById = new Map<string, number>();
  for (const [id, m] of membership) {
    if (m.isLead) {
      const leadIdx = indexById.get(id);
      if (leadIdx != null) groupEndById.set(m.groupId, leadIdx + m.items.length);
    }
  }
  for (let i = 0; i < n; i++) {
    const msg = all[i]!;
    if (!isProcessRow(msg)) continue;
    const m = membership.get(msg.id);
    let boundary = i + 1;
    if (m) {
      const end = groupEndById.get(m.groupId);
      if (end != null) boundary = Math.max(boundary, end);
    }
    if (boundary < n && hasVisibleAfter[boundary]) settled.add(msg.id);
  }
  return settled;
});

function rowSettled(msg: ChatMessage): boolean {
  return settledRowIds.value.has(msg.id);
}

/**
 * Assistant rows that ended their user round. Only these show the copy /
 * speak / regenerate actions — a mid-round narration (text + toolCall, with
 * more work to follow) must not render like a finished turn.
 */
const finalAnswerIds = computed(() => {
  const rows = displayMessages.value.map((m) => ({
    id: m.id,
    role: m.role,
    toolName: m.role === "tool" ? m.toolName : "",
    hasText: m.role === "assistant" ? Boolean(m.text) : false,
    hasThinking: m.role === "assistant" ? Boolean(m.thinking) : false,
  }));
  return finalAnswerRowIds(rows);
});

function isFinalAnswer(msg: ChatMessage): boolean {
  return msg.role === "assistant" && finalAnswerIds.value.has(msg.id);
}

const visibleMessages = computed(() =>
  displayMessages.value.slice(renderStart.value, renderEnd.value),
);

function estimateMessageHeight(msg: ChatMessage | undefined): number {
  if (!msg) return EST_MSG_HEIGHT;
  const group = workSectionMembership.value.get(msg.id);
  if (group) {
    if (!group.isLead) return 0;
    return heightById.get(heightKey(group.leadId)) || EST_TOOL_GROUP_HEIGHT;
  }
  return heightById.get(heightKey(msg.id)) || EST_MSG_HEIGHT;
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

/**
 * Below this estimated total height the whole list mounts without a trailing
 * window: a windowed head would render as blank spacer (and drop the opening
 * user prompt from view) even though everything would fit on screen.
 */
const FULL_MOUNT_MAX_PX = 2000;

function fitsFullMount(len: number): boolean {
  return len <= VIRTUAL_WINDOW || estimateRangeHeight(0, len) <= FULL_MOUNT_MAX_PX;
}

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
 * scrolled out of view). Unmounted rows above the window never render (the
 * spacer is blank), so the nearest user message up there is always pinnable.
 */
function findStickyUserMessageId(): string | null {
  const sc = scroller.value;
  const all = displayMessages.value;
  if (!sc || all.length === 0) return null;

  const viewportTop = sc.scrollTop + 8;

  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i]!;
    if (m.role !== "user") continue;
    if (i < renderStart.value) return m.id;
    const top = topById.get(m.id);
    if (top == null) continue;
    // Real position: pin only when the WHOLE row is above the viewport;
    // otherwise keep scanning upward for an older fully-scrolled-out prompt.
    if (top + estimateMessageHeight(m) < viewportTop) return m.id;
  }

  return null;
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

/**
 * A work section renders only on its lead row — a window that starts inside a
 * group would mount followers as empty 0-height rows. Widen the start upward
 * to the group's lead so the section stays whole.
 */
function groupAlignedStart(start: number, end: number): number {
  const all = displayMessages.value;
  if (start <= 0 || start >= all.length || start >= end) return start;
  const m = workSectionMembership.value.get(all[start]!.id);
  if (!m) return start;
  const leadIdx = all.findIndex((r) => r.id === m.leadId);
  return leadIdx >= 0 && leadIdx < start ? leadIdx : start;
}

function alignRenderWindowToGroup(start: number, end: number): void {
  const len = displayMessages.value.length;
  const clampedEnd = Math.max(0, Math.min(end, len));
  const clampedStart = groupAlignedStart(Math.max(0, Math.min(start, clampedEnd)), clampedEnd);
  renderStart.value = clampedStart;
  renderEnd.value = clampedEnd;
}

/**
 * 贴底窗口：从尾部向上累加估算高度，直到能盖住视口（至少 VIRTUAL_WINDOW 行）。
 * 长摘要折叠后尾部只剩一行表头，固定行数的尾窗会让视口落进顶部 spacer，
 * 看起来就是一大片空白。
 */
function tailWindowForViewport(len: number): { start: number; end: number } {
  const all = displayMessages.value;
  const need = (scroller.value?.clientHeight ?? 0) + OVERSCAN_PX;
  const minStart = Math.max(0, len - VIRTUAL_WINDOW);
  let start = minStart;
  let height = 0;
  for (let i = len - 1; i >= 0; i--) {
    height += estimateMessageHeight(all[i]);
    if (height >= need && i <= minStart) {
      start = i;
      break;
    }
    if (i === 0) {
      start = 0;
      break;
    }
  }
  return { start: groupAlignedStart(start, len), end: len };
}

function clampRenderWindow(preferBottom: boolean): void {
  const len = displayMessages.value.length;
  // Mount-all only while pinned to the bottom (callers re-pin after the
  // clamp); expanding mid-read has no scroll compensation and would jump.
  if (preferBottom && fitsFullMount(len)) {
    renderStart.value = 0;
    renderEnd.value = len;
    return;
  }
  if (len <= VIRTUAL_WINDOW) {
    renderStart.value = 0;
    renderEnd.value = len;
    return;
  }
  if (preferBottom) {
    const tail = tailWindowForViewport(len);
    alignRenderWindowToGroup(tail.start, tail.end);
    return;
  }
  // Keep current window sized and clamped inside [0, len].
  let start = Math.max(0, Math.min(renderStart.value, len));
  let end = Math.max(start, Math.min(renderEnd.value, len));
  if (end - start < Math.min(VIRTUAL_WINDOW, len)) {
    end = Math.min(len, start + VIRTUAL_WINDOW);
    start = Math.max(0, end - VIRTUAL_WINDOW);
  }
  alignRenderWindowToGroup(start, end);
}

function measureVisibleRows(): void {
  const sc = scroller.value;
  if (!sc || paneHidden()) return;
  const rows = sc.querySelectorAll<HTMLElement>(".row[data-msg-id]");
  for (const row of rows) {
    const id = row.dataset.msgId;
    if (!id) continue;
    // Use layout height for virtual window estimates.
    const h = row.offsetHeight;
    if (h > 0) heightById.set(heightKey(id), h);
    // Real layout offset inside the scroller (rows are flex children of .inner).
    const top = row.offsetTop;
    if (top > 0 || row === rows[0]) topById.set(id, top);
  }
}

/**
 * Re-measure a single row after its own content resized (e.g. a work section
 * finished its fold/unfold animation). Keeps virtual-window heights in sync
 * without a full relayout — the source of the "janky" fold.
 * 拖动分隔条 / 缩放窗口时每帧会收到多个分组的高度变化，按帧合并成一次测量。
 */
let resizedRowRaf = 0;
const resizedRowIds = new Set<string>();
function rowResized(id: string): void {
  if (adjustingWindow || settlingSession || paneHidden()) return;
  resizedRowIds.add(id);
  if (resizedRowRaf) return;
  resizedRowRaf = requestAnimationFrame(() => {
    resizedRowRaf = 0;
    const ids = [...resizedRowIds];
    resizedRowIds.clear();
    const sc = scroller.value;
    if (!sc) return;
    for (const rowId of ids) {
      const row = sc.querySelector<HTMLElement>(`.row[data-msg-id="${rowId}"]`);
      if (!row) continue;
      const h = row.offsetHeight;
      if (h > 0) heightById.set(heightKey(rowId), h);
      const top = row.offsetTop;
      if (top > 0) topById.set(rowId, top);
    }
    ensureViewportCovered();
  });
}

/**
 * 行高变化（长摘要折叠/展开）后视口可能落进 spacer 覆盖的未挂载区域 ——
 * 屏幕上就只剩一片空白。这里就地补挂对应方向的行，让视口重新被真实内容盖住。
 */
function ensureViewportCovered(): void {
  if (adjustingWindow || settlingSession || document.hidden) return;
  if (paneHidden()) return;
  const sc = scroller.value;
  if (!sc) return;
  // 已挂载内容不足一屏且确实有 spacer：行高可能在被卸载期间变化过，先量一次再判断。
  const mountedHeight = sc.scrollHeight - topSpacerPx.value - bottomSpacerPx.value;
  if (mountedHeight < sc.clientHeight && (topSpacerPx.value > 0 || bottomSpacerPx.value > 0)) {
    measureVisibleRows();
  }
  if (renderStart.value > 0 && sc.scrollTop < topSpacerPx.value + OVERSCAN_PX) {
    expandHistoryUp();
    return;
  }
  const len = displayMessages.value.length;
  if (
    renderEnd.value < len &&
    sc.scrollTop + sc.clientHeight > sc.scrollHeight - bottomSpacerPx.value - OVERSCAN_PX
  ) {
    expandHistoryDown();
  }
}

/** 视口内首/尾两条可见行，作为窗口变更后的位置基准。 */
type ScrollAnchor = { id: string; viewportTop: number };
type ScrollAnchors = { first: ScrollAnchor | null; last: ScrollAnchor | null };

function captureScrollAnchors(): ScrollAnchors {
  const anchors: ScrollAnchors = { first: null, last: null };
  const sc = scroller.value;
  if (!sc) return anchors;
  const scRect = sc.getBoundingClientRect();
  for (const row of sc.querySelectorAll<HTMLElement>(".row[data-msg-id]")) {
    const id = row.dataset.msgId;
    if (!id) continue;
    const rect = row.getBoundingClientRect();
    if (rect.bottom <= scRect.top || rect.top >= scRect.bottom) continue;
    const anchor = { id, viewportTop: rect.top - scRect.top };
    if (!anchors.first) anchors.first = anchor;
    anchors.last = anchor;
  }
  return anchors;
}

/**
 * 窗口变更后把锚点行放回原视口位置，按行的真实位移补偿。
 * 不能用整体高度差：它把窗口内其它行的内容变化（流式输出、异步 Markdown）
 * 和 spacer 估算误差一并算进去，等于每次调整都把视图往底部推。
 * 向上扩展裁尾部、向下扩展裁头部，所以首/尾锚点至少有一个还在。
 */
function restoreScrollAnchor(
  anchors: ScrollAnchors,
  prevHeight: number,
  prevTop: number,
): void {
  const sc = scroller.value;
  if (!sc) return;
  const scTop = sc.getBoundingClientRect().top;
  for (const anchor of [anchors.first, anchors.last]) {
    if (!anchor) continue;
    const row = sc.querySelector<HTMLElement>(
      `.row[data-msg-id="${CSS.escape(anchor.id)}"]`,
    );
    if (!row) continue;
    sc.scrollTop += row.getBoundingClientRect().top - scTop - anchor.viewportTop;
    return;
  }
  // 两个锚点都被卸载时退回高度差补偿。
  sc.scrollTop = prevTop + (sc.scrollHeight - prevHeight);
}

/** After a window mutate, continue prefetch on the next frame (yields to paint — no nextTick storm). */
function scheduleWindowPrefetch(): void {
  requestAnimationFrame(() => {
    const sc = scroller.value;
    if (!sc || adjustingWindow || settlingSession) return;
    if (renderStart.value > 0 && sc.scrollTop < topSpacerPx.value + OVERSCAN_PX) {
      expandHistoryUp();
      return;
    }
    if (followBottom) return;
    const bottomEdge = sc.scrollHeight - bottomSpacerPx.value;
    if (sc.scrollTop + sc.clientHeight > bottomEdge - OVERSCAN_PX) {
      expandHistoryDown();
    }
  });
}

function expandHistoryUp(): void {
  if (adjustingWindow) return;
  if (renderStart.value <= 0) return;
  const sc = scroller.value;
  if (!sc) return;
  adjustingWindow = true;
  const prevHeight = sc.scrollHeight;
  const prevTop = sc.scrollTop;
  const anchor = captureScrollAnchors();
  const nextStart = Math.max(0, renderStart.value - VIRTUAL_CHUNK);
  let nextEnd = renderEnd.value;
  // Trim far (bottom) side so mounting stays bounded while scrolling up.
  // 被裁掉的行必须在视口下方，否则底部 spacer 会顶进视口（露出空白）。
  const trimEnd = nextStart + VIRTUAL_MAX;
  if (!followBottom && trimEnd < nextEnd) {
    const trimTop = sc.scrollHeight - bottomSpacerPx.value - estimateRangeHeight(trimEnd, nextEnd);
    if (trimTop > sc.scrollTop + sc.clientHeight + OVERSCAN_PX) nextEnd = trimEnd;
  }
  if (fitsFullMount(displayMessages.value.length)) {
    renderStart.value = 0;
    renderEnd.value = displayMessages.value.length;
  } else {
    alignRenderWindowToGroup(nextStart, nextEnd);
  }
  void nextTick(() => {
    restoreScrollAnchor(anchor, prevHeight, prevTop);
    measureVisibleRows();
    adjustingWindow = false;
    updateStickyPinned();
    scheduleWindowPrefetch();
    ensureViewportCovered();
  });
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
  const anchor = captureScrollAnchors();
  renderEnd.value = Math.min(len, renderEnd.value + VIRTUAL_CHUNK);
  // Trim far (top) side — never grow past VIRTUAL_MAX (sticky is overlay-only).
  // 被裁掉的行必须完全在视口上方，否则顶部 spacer 会露进视口（“到最顶上大片空白”）。
  let nextStart = renderStart.value;
  const trimStart = renderEnd.value - VIRTUAL_MAX;
  if (trimStart > nextStart) {
    const trimBottom = topSpacerPx.value + estimateRangeHeight(nextStart, trimStart);
    if (sc.scrollTop > trimBottom + OVERSCAN_PX) nextStart = trimStart;
  }
  if (fitsFullMount(len)) {
    renderStart.value = 0;
    renderEnd.value = len;
  } else {
    alignRenderWindowToGroup(nextStart, renderEnd.value);
  }
  void nextTick(() => {
    restoreScrollAnchor(anchor, prevHeight, prevTop);
    measureVisibleRows();
    adjustingWindow = false;
    updateStickyPinned();
    scheduleWindowPrefetch();
    ensureViewportCovered();
  });
}

let instantSnapToken = 0;
function jumpToBottomInstant(): void {
  // Jump control / settle are the only callers; anything else must not move
  // the viewport while the user is reading history.
  if (readingHistory || paneHidden()) return;
  const sc = scroller.value;
  if (!sc) return;
  const token = ++instantSnapToken;
  sc.scrollTop = sc.scrollHeight;
  // Deferred re-snaps must re-check follow: the user may scroll up while these
  // rAFs are still queued — never yank the viewport back down afterwards.
  requestAnimationFrame(() => {
    if (token !== instantSnapToken || (!followBottom && !settlingSession)) return;
    if (readingHistory) return;
    const el = scroller.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      if (token !== instantSnapToken || (!followBottom && !settlingSession)) return;
      if (readingHistory) return;
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
/**
 * 每 tick 同步量高会强制布局（offsetHeight 读取），高 chunk 频率下占满主线程。
 * 流式期间合并为 ~250ms 尾随测量，滚动 / 窗口调整路径仍各自即时测量。
 */
let streamMeasureTimer = 0;
function scheduleStreamMeasure(): void {
  if (streamMeasureTimer) return;
  streamMeasureTimer = window.setTimeout(() => {
    streamMeasureTimer = 0;
    measureVisibleRows();
  }, 250);
}
function scheduleBottomScroll(): void {
  // Hard latch first: a reader must never be yanked, even if followBottom is
  // still momentarily true in a state snapshot taken mid-wheel.
  if (readingHistory) return;
  // Minimized / hidden: no layout work until the window is restored.
  if (document.hidden || paneHidden()) return;
  if (bottomScrollRaf) return;
  bottomScrollRaf = requestAnimationFrame(() => {
    bottomScrollRaf = 0;
    const sc = scroller.value;
    // Re-check at fire time, not just schedule time: the user may have scrolled
    // up after the snap was queued (the follow decision is sync, this rAF is
    // not) — never yank the viewport back down while they read history.
    if (!sc || document.hidden || paneHidden() || !followBottom) return;
    // Even when a prior state sample left follow=true (samples are not atomic
    // with a mid-await wheel), the hard reading latch still wins at fire time.
    if (readingHistory) return;
    sc.scrollTop = sc.scrollHeight;
  });
}

/** 面板 / 窗口重新可见：贴底收敛一次，不重新量全部行高。 */
function onBecameVisible(): void {
  if (paneHidden() || document.hidden) return;
  if (!followBottom || readingHistory) return;
  clampRenderWindow(true);
  scheduleBottomScroll();
  requestAnimationFrame(() => {
    measureVisibleRows();
    scheduleBottomScroll();
  });
}

/** Restored from minimized: land at the live edge without a big re-measure. */
function onVisibilityChange(): void {
  if (document.hidden) return;
  onBecameVisible();
}

watch(
  () => props.visible,
  (visible) => {
    if (visible !== false) onBecameVisible();
  },
);

function jumpToLatest(): void {
  disengageHistoryReading();
  showJumpLatest.value = false;
  clampRenderWindow(true);
  void nextTick(() => {
    measureVisibleRows();
    jumpToBottomInstant();
  });
}

/** Bottom snap for session settle / post-hydrate; guards follow + settle + latch. */
function snapSessionToBottom(token: number): void {
  if (token !== sessionJumpToken) return;
  if (settlingSession) {
    // settle state is being snapped anyway — do NOT reset a mid-settle latch.
    clampRenderWindow(true);
    lastPinnedUserId = latestUserMessageId.value;
    return;
  }
  // historyLoading finished outside settle (hydrate landed late): jump to live.
  if (!followBottom && !readingHistory) {
    disengageHistoryReading();
    clampRenderWindow(true);
    lastPinnedUserId = latestUserMessageId.value;
  }
  jumpToBottomInstant();
  updateStickyPinned();
  refreshStickyToggleNeed();
}

/** Cold start + session switch: wait for hydrate, then land on bottom (no blank spacer). */
async function beginSessionSettle(): Promise<void> {
  const token = ++sessionJumpToken;
  settlingSession = true;
  settlingUi.value = true;
  disengageHistoryReading();
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

  // An empty list after the hydrate frame is final (brand-new session) — don't
  // burn the old 400ms empty-poll on every fresh chat.
  if (displayMessages.value.length === 0) {
    const emptyDeadline = Date.now() + 120;
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
  // Land on the bottom BEFORE revealing (the old flow revealed only after all
  // re-snaps; with early reveal the stale scroll offset would flash otherwise).
  if (token === sessionJumpToken) {
    await nextTick();
    jumpToBottomInstant();
    settlingUi.value = false;
  }
  for (const waitMs of [0, 50, 120, 280, 600]) {
    if (waitMs) await new Promise<void>((r) => setTimeout(r, waitMs));
    if (token !== sessionJumpToken) return;
    await snapSessionToBottom(token);
  }
  if (token === sessionJumpToken) {
    settlingSession = false;
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

/** 用户明确开始读历史：立即脱离贴底，不再被任何排队中的贴底拉回。 */
function engageUserHistoryScroll(): void {
  if (readingHistory && !followBottom) return;
  const sc = scroller.value;
  if (!sc || sc.scrollHeight <= sc.clientHeight + 1) return;
  cancelSessionSettle();
  suppressFollowBottomUntil = 0;
  userScrolledAway = true;
  followBottom = false;
  cancelQueuedBottomSnaps();
  engageHistoryReading();
}

/** 会话贴底是多段异步快照，用户中途上滑时整体取消。 */
function cancelSessionSettle(): void {
  if (!settlingSession) return;
  sessionJumpToken++;
  settlingSession = false;
  settlingUi.value = false;
}

function syncFollowBottomOnScroll(sc: HTMLElement): void {
  // While the virtual window adjusts the DOM, scroll events are synthetic — the
  // decision machine must not run at all (a synthetic nudge could otherwise
  // look like the user scrolling back down).
  if (adjustingWindow || settlingSession) {
    lastSyncScrollTop = sc.scrollTop;
    return;
  }
  const decision = decideFollowOnScroll({
    top: sc.scrollTop,
    lastTop: lastSyncScrollTop,
    nearBottom: isNearBottom(sc),
    now: Date.now(),
    suppressUntil: suppressFollowBottomUntil,
    away: userScrolledAway,
    following: followBottom,
    guarded: false,
  });
  lastSyncScrollTop = sc.scrollTop;
  userScrolledAway = decision.away;
  suppressFollowBottomUntil = decision.suppressUntil;
  followBottom = decision.following;
  if (!followBottom) cancelQueuedBottomSnaps();
  // While a user is reading history (hard latch), every extra list insert
  // shifts the DOM; synthetic scroll events then fire. Those are not
  // intent — the state machine stays inert except for a real return into the
  // live edge, which releases the latch (decideFollowOnScroll only reports
  // following=true once the user scrolls back into the near-bottom zone).
  if (readingHistory) {
    if (!decision.following) {
      showJumpLatest.value = displayMessages.value.length > 0;
      return;
    }
    disengageHistoryReading();
  }
  // Return to the live edge = explicit "stop reading history" intent.
  if (!followBottom) engageHistoryReading();
  showJumpLatest.value = !followBottom && displayMessages.value.length > 0;
}

/**
 * Wheel events only fire for real user input (programmatic scrollTop writes do
 * not). One upward tick disengages follow immediately — even inside the
 * near-bottom threshold, where stream snaps would otherwise keep resetting the
 * user's scroll progress every chunk and they could never escape.
 */
function onScrollerWheel(event: WheelEvent): void {
  if (event.deltaY >= 0) return;
  const sc = scroller.value;
  if (!sc) return;
  engageUserHistoryScroll();
}

function onScrollerKeydown(event: KeyboardEvent): void {
  if (event.key !== "ArrowUp" && event.key !== "PageUp" && event.key !== "Home") return;
  engageUserHistoryScroll();
}

let touchStartY = -1;
function onScrollerTouchStart(event: TouchEvent): void {
  touchStartY = event.touches[0]?.clientY ?? -1;
}

/** 手指下移 = 内容上滚 = 回看更早的消息（触摸屏 / 手机网页端没有 wheel 事件）。 */
function onScrollerTouchMove(event: TouchEvent): void {
  const y = event.touches[0]?.clientY;
  if (y == null || touchStartY < 0 || y <= touchStartY + 8) return;
  engageUserHistoryScroll();
}

/** 指针落在滚动条区域（元素内容区右侧）时同样视为主动滚动。 */
function onScrollerPointerDown(event: PointerEvent): void {
  const sc = scroller.value;
  if (!sc) return;
  if (event.clientX < sc.getBoundingClientRect().left + sc.clientWidth) return;
  engageUserHistoryScroll();
}

/** Heavy virtual-window / prefetch work stays rAF-coalesced (follow already synced). */
function handleScrollerScroll(): void {
  const sc = scroller.value;
  if (!sc || adjustingWindow || settlingSession) return;

  if (followBottom) {
    const len = displayMessages.value.length;
    const ideal = fitsFullMount(len) ? { start: 0, end: len } : tailWindowForViewport(len);
    if (renderStart.value !== ideal.start || renderEnd.value !== ideal.end) {
      alignRenderWindowToGroup(ideal.start, ideal.end);
      // The clamp changes content above the live edge — re-pin so the
      // viewport stays on the bottom instead of sliding into the spacer.
      void nextTick(() => {
        const el = scroller.value;
        if (!el || !followBottom || readingHistory || adjustingWindow) return;
        el.scrollTop = el.scrollHeight;
        measureVisibleRows();
        ensureViewportCovered();
      });
    } else {
      ensureViewportCovered();
    }
    return;
  }

  // Prefetch above: expand before the viewport hits blank spacer.
  if (renderStart.value > 0 && sc.scrollTop < topSpacerPx.value + OVERSCAN_PX) {
    expandHistoryUp();
  }
  // Prefetch below: keep continuity when scrolling back toward latest.
  const bottomEdge = sc.scrollHeight - bottomSpacerPx.value;
  if (sc.scrollTop + sc.clientHeight > bottomEdge - OVERSCAN_PX) {
    expandHistoryDown();
  }
}

function onScrollerScroll(): void {
  if (paneHidden()) return;
  const sc = scroller.value;
  if (sc) syncFollowBottomOnScroll(sc);
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    handleScrollerScroll();
    updateStickyPinned();
  });
}

function engageHistoryReading(): void {
  readingHistory = true;
  showJumpLatest.value = true;
}

function disengageHistoryReading(): void {
  readingHistory = false;
  followBottom = true;
  userScrolledAway = false;
  lastSyncScrollTop = -1;
}

watch(
  () => sessionId.value,
  () => {
    disengageHistoryReading();
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
    const hydratedFromEmpty = (prevLen === 0 || prevLen == null) && len > 0;
    // Only pin the trailing window when the user is following the bottom.
    // (Do NOT yank the window during agent runs if the user scrolled up to read history.)
    if (readingHistory) {
      // List growth above the anchored read position is fine — the spacer
      // absorbs it and the browser keeps the anchored row on screen.
      if (!hydratedFromEmpty) clampRenderWindow(false);
    } else if (followBottom || hydratedFromEmpty) {
      clampRenderWindow(true);
    } else if (len <= VIRTUAL_WINDOW) {
      renderStart.value = 0;
      renderEnd.value = len;
    } else {
      clampRenderWindow(false);
    }
    // Critical: hydrate often lands AFTER settle timeouts. Always snap when
    // following bottom / first populate, otherwise the virtual spacer stays in view (blank).
    // Skip while hidden — the visibility handler re-snaps once on restore.
    if (
      (followBottom || settlingSession || hydratedFromEmpty) &&
      !document.hidden &&
      !readingHistory
    ) {
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
    if (readingHistory) return;
    // A *new* trailing message while already following: just re-clamp + snap.
    if (followBottom) {
      clampRenderWindow(true);
      lastPinnedUserId = latestUserMessageId.value;
      void nextTick(() => {
        if (!followBottom && !settlingSession) return;
        jumpToBottomInstant();
      });
    } else if (!settlingSession) {
      // hydrate landed late (settle already finished) — snap now.
      snapSessionToBottom(sessionJumpToken);
    }
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
    const prevReading = readingHistory;
    lastPinnedUserId = id;
    if (prevReading) {
      // While the user was reading history and sends a follow-up, follow them
      // down to the new tail — jump immediately, don't wait for settle logic.
      disengageHistoryReading();
      clampRenderWindow(true);
      suppressFollowBottomUntil = Date.now() + 160;
      await nextTick();
      measureVisibleRows();
      updateStickyPinned();
      refreshStickyToggleNeed();
      const sc = scroller.value;
      const card = sc?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`) as HTMLElement | null;
      if (!sc || !card) return;
      const scRect = sc.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const top = cardRect.bottom - scRect.top + sc.scrollTop - sc.clientHeight + 8;
      sc.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return;
    }
    // Session switch / hydrate: land on bottom instantly (no slide).
    disengageHistoryReading();
    clampRenderWindow(true);
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
    const sc2 = scroller.value;
    const card2 = sc2?.querySelector(
      `[data-msg-id="${CSS.escape(id)}"]`,
    ) as HTMLElement | null;
    if (!sc2 || !card2) return;
    // Show the end of the full prompt (no height clamp until actually pinned).
    const scRect2 = sc2.getBoundingClientRect();
    const cardRect2 = card2.getBoundingClientRect();
    const top2 = cardRect2.bottom - scRect2.top + sc2.scrollTop - sc2.clientHeight + 8;
    sc2.scrollTo({ top: Math.max(0, top2), behavior: "smooth" });
  },
);

watch(
  () => [props.messages.length, props.streaming, props.running] as const,
  async ([, streaming, running], prev) => {
    if (Date.now() < suppressFollowBottomUntil) return;
    if (document.hidden || readingHistory) return;
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
      if (justFinished) measureVisibleRows();
      else scheduleStreamMeasure();
      if (justFinished) {
        requestAnimationFrame(() => {
          const sc = scroller.value;
          if (sc && followBottom && !readingHistory) sc.scrollTop = sc.scrollHeight;
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
    if (document.hidden || readingHistory) return;
    await nextTick();
    scheduleBottomScroll();
  },
);

onMounted(() => {
  const sc = scroller.value;
  sc?.addEventListener("scroll", onScrollerScroll, { passive: true });
  sc?.addEventListener("wheel", onScrollerWheel, { passive: true });
  sc?.addEventListener("keydown", onScrollerKeydown);
  sc?.addEventListener("touchstart", onScrollerTouchStart, { passive: true });
  sc?.addEventListener("touchmove", onScrollerTouchMove, { passive: true });
  sc?.addEventListener("pointerdown", onScrollerPointerDown, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  // Auto-load on startup mounts MessageList *after* activeId is set, so the
  // sessionId watcher may not re-fire — settle here or the spacer looks blank.
  void beginSessionSettle();
  void loadModelNames();
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener("scroll", onScrollerScroll);
  scroller.value?.removeEventListener("wheel", onScrollerWheel);
  scroller.value?.removeEventListener("keydown", onScrollerKeydown);
  scroller.value?.removeEventListener("touchstart", onScrollerTouchStart);
  scroller.value?.removeEventListener("touchmove", onScrollerTouchMove);
  scroller.value?.removeEventListener("pointerdown", onScrollerPointerDown);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (scrollRaf) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }
  if (bottomScrollRaf) {
    cancelAnimationFrame(bottomScrollRaf);
    bottomScrollRaf = 0;
  }
  if (streamMeasureTimer) {
    clearTimeout(streamMeasureTimer);
    streamMeasureTimer = 0;
  }
  if (resizedRowRaf) {
    cancelAnimationFrame(resizedRowRaf);
    resizedRowRaf = 0;
  }
  resizedRowIds.clear();
  instantSnapToken++;
});

/**
 * The current round finished (nothing streaming and nothing running): fold all
 * process rows (tools + thinking) so only the user question and final answer
 * stay prominent, Codex-style. Users can still re-expand any row manually.
 */
const turnDone = computed(() => !props.running && !props.streaming);

/**
 * opencode DiffSummary：每轮（user 行分隔）的文件改动汇总，挂在轮末最终回答
 * 下方。统计用完整消息 — 历史轮的工具行在渲染时被裁剪，计数仍要算上它们。
 */
const turnDiffsByRow = computed(() => {
  const out = new Map<string, TurnFileChanges>();
  const stats = collectTurnFileChanges(allMessages.value, toolCard, turnDone.value);
  if (!stats.size) return out;
  const sourceIds = lastIdPerRound(allMessages.value, (msg) => msg.role !== "user");
  const answerIds = lastIdPerRound(
    displayMessages.value,
    (msg) => msg.role === "assistant" && Boolean(msg.text),
  );
  for (let i = 0; i < sourceIds.length; i++) {
    const sourceId = sourceIds[i];
    const rowId = answerIds[i];
    const changes = sourceId ? stats.get(sourceId) : undefined;
    if (changes && rowId) out.set(rowId, changes);
  }
  return out;
});

function turnDiffFor(msg: ChatMessage): TurnFileChanges | null {
  return turnDiffsByRow.value.get(msg.id) ?? null;
}

/** 每轮（user 行分隔）最后一个命中行的 id；null 表示该轮没有命中行。 */
function lastIdPerRound(
  msgs: readonly ChatMessage[],
  match: (msg: ChatMessage) => boolean,
): (string | null)[] {
  const ids: (string | null)[] = [];
  let last: string | null = null;
  for (const msg of msgs) {
    if (msg.role === "user") {
      ids.push(last);
      last = null;
      continue;
    }
    if (match(msg)) last = msg.id;
  }
  ids.push(last);
  return ids;
}

const openTurnDiffs = ref(new Set<string>());

function isTurnDiffOpen(id: string): boolean {
  return openTurnDiffs.value.has(id);
}

function toggleTurnDiff(id: string): void {
  const next = new Set(openTurnDiffs.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  openTurnDiffs.value = next;
}

/**
 * Memoized card parsing (shared cache `toolCardFor` in tool-diff.ts): the same
 * message object never re-parses its diff. Write/edit diff synthesis is
 * O(file size) and used to run again on every unrelated re-render (other tool
 * streams, phase-clock ticks, status flips), which starved the UI thread while
 * an agent ran bash / edited large files.
 */

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

/** `provider/id` → 模型目录中的显示名。 */
const modelNames = ref<Record<string, string>>({});

async function loadModelNames(): Promise<void> {
  try {
    const data = await window.api.models.get();
    modelNames.value = Object.fromEntries(
      data.available.map((m) => [`${m.provider}/${m.id}`, m.name]),
    );
  } catch {
    // 取不到目录时退回原始 model id
  }
}

/**
 * "Claude Sonnet 4.5 · High"：本轮结束使用的模型与思考级别。
 * 思考为 off 时不展示级别；模型名缺失时退回 model id。
 */
function assistantModelDetail(
  msg: Extract<ChatMessage, { role: "assistant" }>,
): { compact: string; detail: string } | null {
  const usage = sessions.activeContextUsage;
  const model = msg.model ?? usage?.model ?? null;
  const rawLevel = msg.thinkingLevel ?? usage?.thinkingLevel ?? null;
  const name = model
    ? (modelNames.value[`${model.provider}/${model.id}`] ?? model.id)
    : null;
  const level = rawLevel && rawLevel !== "off" ? thinkingLevelLabel(rawLevel) : null;
  if (!name && !level) return null;
  return {
    compact: [name, level].filter(Boolean).join(" · "),
    detail: t.assistantModelTitle(name ?? "—", level ?? "—"),
  };
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

/** 把一条 user 气泡放回输入框（重新编辑或还原检查点后用）。 */
function loadComposerFromUser(msg: Extract<ChatMessage, { role: "user" }>): void {
  composer.clear();
  composer.draft = displayUserText(msg.text);
  for (const img of msg.images ?? []) {
    composer.addImageFromDataUrl(img.dataUrl);
  }
  for (const tag of visibleUserTags(msg.elementTags)) {
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
}

function onEditUser(msg: Extract<ChatMessage, { role: "user" }>): void {
  const id = sessionId.value;
  if (!id || props.running) return;
  const edited = chat.beginEditUser(id, msg.id);
  if (!edited) return;
  if (sendQueue.editingId) sendQueue.setEditing(id, null);
  loadComposerFromUser(edited);
  messageApi.info(t.loadedForReEdit);
}

/**
 * 回退到本轮结束：保留本轮问答，丢弃之后的全部轮次；文件保持现状。
 */
function onRestoreCheckpoint(msg: Extract<ChatMessage, { role: "user" }>): void {
  const id = sessionId.value;
  if (!id) return;
  const d = dialog.warning({
    title: t.restoreCheckpoint,
    content: t.restoreCheckpointConfirm,
    positiveText: t.confirm,
    negativeText: t.cancel,
    onPositiveClick: () => {
      d.loading = true;
      return (async () => {
        try {
          const restored = await chat.restoreTurn(id, msg.id);
          if (!restored.ok) {
            messageApi.error(t.restoreCheckpointFail(t.turnMismatch));
            d.loading = false;
            return false;
          }
          messageApi.success(t.restoreCheckpointDone);
          return true;
        } catch (err) {
          messageApi.error(
            t.restoreCheckpointFail(err instanceof Error ? err.message : String(err)),
          );
          d.loading = false;
          return false;
        }
      })();
    },
  });
}

/** assistant 行归属到本轮最近的 user 消息，操作行的检查点/派生按钮需要它。 */
const roundUserByRow = computed(() => {
  const map = new Map<string, Extract<ChatMessage, { role: "user" }>>();
  let current: Extract<ChatMessage, { role: "user" }> | null = null;
  for (const m of props.messages) {
    if (m.role === "user") current = m;
    else if (current) map.set(m.id, current);
  }
  return map;
});

function roundUserOf(msg: ChatMessage): Extract<ChatMessage, { role: "user" }> | null {
  return roundUserByRow.value.get(msg.id) ?? null;
}

/** 最后一轮没有可丢弃的后续轮次，还原检查点不适用（文件撤回仍可用）。 */
function isLatestRound(msg: ChatMessage): boolean {
  return roundUserOf(msg)?.id === latestUserMessageId.value;
}

/** 历史轮的助手回答在会话运行中也要显示操作栏；当前轮等本轮结束。 */
function canShowAssistantActions(msg: ChatMessage): boolean {
  if (msg.role !== "assistant" || msg.streaming || !isFinalAnswer(msg)) return false;
  return !props.running || !isLatestRound(msg);
}

/** VS Code Copilot 的 Fork Conversation：把到本轮为止的对话复制成新会话。 */
async function onForkConversation(msg: Extract<ChatMessage, { role: "user" }>): Promise<void> {
  const id = sessionId.value;
  if (!id) return;
  try {
    const forkedId = await chat.forkConversation(id, msg.id);
    if (!forkedId) {
      messageApi.error(t.forkConversationFail(t.turnMismatch));
      return;
    }
    messageApi.success(t.forkConversationDone);
  } catch (err) {
    messageApi.error(
      t.forkConversationFail(err instanceof Error ? err.message : String(err)),
    );
  }
}

async function onRegenerate(msg: Extract<ChatMessage, { role: "assistant" }>): Promise<void> {
  const id = sessionId.value;
  if (!id) return;
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
            return true;
          }
          messageApi.success(t.revertTurnDone(result.restored, result.deleted));
          return true;
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
          workSectionMembership.get(msg.id)?.isLead === false ? 'row-tool-group-follower' : '',
          sessionId && chat.isPendingEditTail(sessionId, msg.id) ? 'row-edit-tail' : '',
        ]"
        :data-msg-id="msg.id"
      >
        <template v-if="workSectionMembership.get(msg.id)?.isLead">
          <div class="tool">
            <WorkSectionGroup
              :items="workSectionMembership.get(msg.id)!.items"
              :auto-collapse="rowSettled(msg)"
              @open="openPreview"
              @resize="rowResized(msg.id)"
            />
          </div>
        </template>
        <template v-else-if="workSectionMembership.has(msg.id)">
          <!-- Folded into the work section on the lead row. -->
        </template>

        <template v-else-if="msg.role === 'user'">
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
                :streaming="Boolean(msg.streaming)"
                variant="chat"
                class="assistant-md"
                :class="{ 'stream-shimmer': msg.streaming && msg.text }"
              />
              <span v-if="msg.streaming && msg.text" class="cursor" aria-hidden="true" />
            </div>
            <div
              v-if="canShowAssistantActions(msg)"
              class="actions"
            >
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
                  <NButton
                    quaternary
                    circle
                    size="tiny"
                    @click="onRegenerate(msg)"
                  >
                    <template #icon>
                      <NIcon :component="RefreshOutline" />
                    </template>
                  </NButton>
                </template>
                {{ t.regenerate }}
              </NTooltip>
              <template v-if="roundUserOf(msg)">
                <NTooltip v-if="!isLatestRound(msg)">
                  <template #trigger>
                    <NButton
                      quaternary
                      circle
                      size="tiny"
                      @click="onRestoreCheckpoint(roundUserOf(msg)!)"
                    >
                      <template #icon>
                        <NIcon :component="ArrowUndoOutline" />
                      </template>
                    </NButton>
                  </template>
                  {{ t.restoreCheckpoint }}
                </NTooltip>
                <NTooltip>
                  <template #trigger>
                    <NButton
                      quaternary
                      circle
                      size="tiny"
                      @click="onForkConversation(roundUserOf(msg)!)"
                    >
                      <template #icon>
                        <NIcon :component="GitBranchOutline" />
                      </template>
                    </NButton>
                  </template>
                  {{ t.forkConversation }}
                </NTooltip>
              </template>
              <span
                v-if="assistantStats(msg)"
                class="assistant-stats"
                :title="assistantStats(msg)!.detail"
              >
                {{ assistantStats(msg)!.compact }}
              </span>
              <span
                v-if="assistantModelDetail(msg)"
                class="assistant-model"
                :title="assistantModelDetail(msg)!.detail"
              >
                {{ assistantModelDetail(msg)!.compact }}
              </span>
            </div>

            <TurnDiffSummary
              v-if="turnDiffFor(msg)"
              :changes="turnDiffFor(msg)!"
              :open="isTurnDiffOpen(msg.id)"
              @toggle="toggleTurnDiff(msg.id)"
              @open-file="openPreview"
            />
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
              :auto-collapse="rowSettled(msg)"
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

      <!--
        Guidance that is waiting its turn. Without this the message vanished from
        the UI the moment it was queued (it only came back as a bubble when the
        agent got to it), which read as "my message was lost".
      -->
      <div v-if="pendingQueueCards.length" class="steer-cards" aria-live="polite">
        <div v-for="item in pendingQueueCards" :key="item.id" class="steer-card">
          <span class="steer-card-tag">{{ t.steerPendingTag }}</span>
          <span class="steer-card-text">{{ queuePreview(item) }}</span>
        </div>
      </div>
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
  max-width: var(--pi-message-max, 75%);
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
  background: var(--bg-elevated, #ffffff);
  color: var(--fg, #222);
  font-size: 12px;
  font-weight: 600;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(14px) saturate(1.15);
  cursor: pointer;
}

.jump-latest:hover {
  background: color-mix(in srgb, var(--bg-elevated, #ffffff) 88%, var(--fg, #222) 12%);
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
  flex-direction: column;
  align-items: flex-end;
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

/* Folded into the work section on the lead row — keep DOM for virtual ids, zero layout. */
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
  border-radius: var(--radius-md, 6px);
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
  border-radius: 6px;
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
  /* Copilot (VS Code) chat typography: 13px / 1.5em, --vscode-chat-font-size-body-m */
  font-size: var(--chat-font-m, 13px);
  line-height: 1.5em;
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
  --n-color: color-mix(in srgb, var(--warning) 20%, transparent) !important;
  --n-text-color: var(--warning) !important;
  --n-border: color-mix(in srgb, var(--warning) 45%, transparent) !important;
}

.user-tag-mode-agent {
  --n-color: color-mix(in srgb, var(--fg-muted) 16%, transparent) !important;
  --n-text-color: var(--fg-muted) !important;
  --n-border: color-mix(in srgb, var(--fg-muted) 40%, transparent) !important;
}

.user-tag-mode-ask {
  --n-color: color-mix(in srgb, var(--accent) 16%, transparent) !important;
  --n-text-color: var(--accent) !important;
  --n-border: color-mix(in srgb, var(--accent) 40%, transparent) !important;
}

.user-tag-mode-task {
  --n-color: color-mix(in srgb, var(--success) 16%, transparent) !important;
  --n-text-color: var(--success) !important;
  --n-border: color-mix(in srgb, var(--success) 40%, transparent) !important;
}

.user-tag :deep(.n-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-image {
  width: 72px;
  height: 72px;
  border-radius: 4px;
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

/* 本轮结束时的模型与思考级别。 */
.assistant-model {
  margin-left: 8px;
  padding-left: 8px;
  border-left: 1px solid var(--border);
  font-size: 10.5px;
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
  background: var(--warning);
}

.retry-detail {
  opacity: 0.8;
}

/* Queued-guidance cards: the message stays visible until the agent takes it. */
.steer-cards {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}

.steer-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px dashed color-mix(in srgb, var(--accent, #2563eb) 45%, var(--border, #e6e8ec));
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent, #2563eb) 6%, transparent);
}

.steer-card-tag {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent, #2563eb);
}

.steer-card-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  opacity: 0.9;
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
  border-radius: 6px;
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
  border-radius: 4px;
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
  border-radius: 4px;
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
  border-radius: 6px;
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
  border-radius: 4px;
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
</style>
