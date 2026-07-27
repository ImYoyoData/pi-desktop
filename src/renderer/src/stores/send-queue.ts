import { defineStore } from "pinia";
import { computed, reactive } from "vue";
import type { ElementCitation, PromptImageContent } from "../../../shared/protocol";
import { useSessionsStore } from "./sessions";

export type QueuedSendItem = {
  id: string;
  text: string;
  images?: PromptImageContent[];
  citations?: ElementCitation[];
  elementTags?: { url: string; host: string; label: string; content?: string }[];
};

function itemId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useSendQueueStore = defineStore("sendQueue", () => {
  const bySession = reactive<Record<string, QueuedSendItem[]>>({});
  /** When true, auto-drain on idle is skipped (immediate-send in progress). */
  const suppressDrain = reactive<Record<string, boolean>>({});
  const sessionsStore = useSessionsStore();

  function list(sessionId: string): QueuedSendItem[] {
    if (!bySession[sessionId]) bySession[sessionId] = [];
    return bySession[sessionId]!;
  }

  const activeItems = computed(() => {
    const id = sessionsStore.activeId;
    if (!id) return [] as QueuedSendItem[];
    return list(id);
  });

  function enqueue(
    sessionId: string,
    payload: Omit<QueuedSendItem, "id"> & { id?: string },
  ): QueuedSendItem {
    const item: QueuedSendItem = {
      id: payload.id ?? itemId(),
      text: payload.text,
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

  function remove(sessionId: string, id: string): QueuedSendItem | null {
    const rows = list(sessionId);
    const idx = rows.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const [removed] = rows.splice(idx, 1);
    return removed ?? null;
  }

  function takeNext(sessionId: string): QueuedSendItem | null {
    const rows = list(sessionId);
    if (!rows.length) return null;
    return rows.shift() ?? null;
  }

  function clearSession(sessionId: string): void {
    delete bySession[sessionId];
    delete suppressDrain[sessionId];
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
    list,
    enqueue,
    updateText,
    remove,
    takeNext,
    clearSession,
    setSuppressDrain,
    isDrainSuppressed,
  };
});
