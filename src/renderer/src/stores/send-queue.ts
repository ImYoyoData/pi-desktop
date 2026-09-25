import { defineStore } from "pinia";
import { computed, reactive } from "vue";
import type { ElementCitation, PromptImageContent } from "../../../shared/protocol";
import { useSessionsStore } from "./sessions";

export type QueuedSendItem = {
  id: string;
  /** Bubble / display text (may be empty when only tags/images). */
  text: string;
  /** Full prompt text for the agent (includes @path chip refs). */
  agentText?: string;
  images?: PromptImageContent[];
  citations?: ElementCitation[];
  elementTags?: {
    url: string;
    host: string;
    label: string;
    content?: string;
    kind?: "file" | "url" | "element" | "agent" | "plan" | "ask" | "task";
  }[];
};

function itemId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useSendQueueStore = defineStore("sendQueue", () => {
  const bySession = reactive<Record<string, QueuedSendItem[]>>({});
  /** Queue item currently loaded into the main composer for editing. */
  const editingBySession = reactive<Record<string, string | null>>({});
  /** When true, auto-drain on idle is skipped (immediate-send in progress). */
  const suppressDrain = reactive<Record<string, boolean>>({});
  /**
   * Guidance that was sent into the running turn and has not surfaced in the
   * transcript yet.
   *
   * A steering message is handed to the agent immediately, but the agent only
   * writes it into the session after the current tool calls finish — so between
   * "sent" and "visible as a bubble" there was nothing on screen and the message
   * looked like it had vanished. These are rendered as pending cards until the
   * transcript catches up.
   */
  const pendingSteers = reactive<Record<string, QueuedSendItem[]>>({});
  const sessionsStore = useSessionsStore();

  function list(sessionId: string): QueuedSendItem[] {
    if (!bySession[sessionId]) bySession[sessionId] = [];
    return bySession[sessionId]!;
  }

  function steerList(sessionId: string): QueuedSendItem[] {
    if (!pendingSteers[sessionId]) pendingSteers[sessionId] = [];
    return pendingSteers[sessionId]!;
  }

  const activeItems = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return [] as QueuedSendItem[];
    return list(id);
  });

  /** In-flight guidance for the active session. */
  const activePendingSteers = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return [] as QueuedSendItem[];
    return steerList(id);
  });

  /** Record guidance that was just handed to the running turn. */
  function addPendingSteer(
    sessionId: string,
    payload: Omit<QueuedSendItem, "id">,
  ): QueuedSendItem {
    const item: QueuedSendItem = {
      id: itemId(),
      text: payload.text,
      agentText: payload.agentText,
      images: payload.images?.length ? payload.images.map((i) => ({ ...i })) : undefined,
      citations: payload.citations?.length ? payload.citations.map((c) => ({ ...c })) : undefined,
      elementTags: payload.elementTags?.length
        ? payload.elementTags.map((t) => ({ ...t }))
        : undefined,
    };
    steerList(sessionId).push(item);
    return item;
  }

  /** Drop a pending steer once its text shows up in the transcript. */
  function clearPendingSteers(sessionId: string): void {
    if (pendingSteers[sessionId]?.length) pendingSteers[sessionId] = [];
  }

  const editingId = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return null;
    return editingBySession[id] ?? null;
  });

  function get(sessionId: string, id: string): QueuedSendItem | null {
    return list(sessionId).find((i) => i.id === id) ?? null;
  }

  function setEditing(sessionId: string, id: string | null): void {
    editingBySession[sessionId] = id;
  }

  function enqueue(
    sessionId: string,
    payload: Omit<QueuedSendItem, "id"> & { id?: string },
  ): QueuedSendItem {
    const item: QueuedSendItem = {
      id: payload.id ?? itemId(),
      text: payload.text,
      agentText: payload.agentText,
      images: payload.images?.length ? payload.images.map((i) => ({ ...i })) : undefined,
      citations: payload.citations?.length ? payload.citations.map((c) => ({ ...c })) : undefined,
      elementTags: payload.elementTags?.length
        ? payload.elementTags.map((t) => ({ ...t }))
        : undefined,
    };
    list(sessionId).push(item);
    return item;
  }

  function updateText(sessionId: string, id: string, text: string): void {
    const row = list(sessionId).find((i) => i.id === id);
    if (row) row.text = text;
  }

  function updateItem(
    sessionId: string,
    id: string,
    payload: Omit<QueuedSendItem, "id">,
  ): QueuedSendItem | null {
    const row = list(sessionId).find((i) => i.id === id);
    if (!row) return null;
    row.text = payload.text;
    row.agentText = payload.agentText;
    row.images = payload.images?.length ? payload.images.map((i) => ({ ...i })) : undefined;
    row.citations = payload.citations?.length
      ? payload.citations.map((c) => ({ ...c }))
      : undefined;
    row.elementTags = payload.elementTags?.length
      ? payload.elementTags.map((t) => ({ ...t }))
      : undefined;
    return row;
  }

  function remove(sessionId: string, id: string): QueuedSendItem | null {
    const rows = list(sessionId);
    const idx = rows.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const [removed] = rows.splice(idx, 1);
    if (editingBySession[sessionId] === id) editingBySession[sessionId] = null;
    return removed ?? null;
  }

  function takeNext(sessionId: string): QueuedSendItem | null {
    const rows = list(sessionId);
    if (!rows.length) return null;
    const next = rows.shift() ?? null;
    if (next && editingBySession[sessionId] === next.id) {
      editingBySession[sessionId] = null;
    }
    return next;
  }

  /** Put an item back at the front after a failed auto-drain send. */
  function requeueFront(sessionId: string, item: QueuedSendItem): void {
    const rows = list(sessionId);
    if (rows.some((row) => row.id === item.id)) return;
    rows.unshift(item);
  }

  function clearSession(sessionId: string): void {
    delete bySession[sessionId];
    delete suppressDrain[sessionId];
    delete editingBySession[sessionId];
    delete pendingSteers[sessionId];
  }

  function setSuppressDrain(sessionId: string, value: boolean): void {
    suppressDrain[sessionId] = value;
  }

  function isDrainSuppressed(sessionId: string): boolean {
    return Boolean(suppressDrain[sessionId]);
  }

  return {
    bySession,
    activeItems,
    activePendingSteers,
    editingId,
    list,
    get,
    setEditing,
    enqueue,
    addPendingSteer,
    clearPendingSteers,
    updateText,
    updateItem,
    remove,
    takeNext,
    requeueFront,
    clearSession,
    setSuppressDrain,
    isDrainSuppressed,
  };
});
