import { create } from "zustand";
import type { ElementCitation, PromptImageContent } from "../../../shared/protocol";
import type { LegacyModeTagKind } from "../../../shared/injected-blocks";
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
    kind?: "file" | "url" | "element" | LegacyModeTagKind;
  }[];
};

function itemId(): string {
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(0, 7)}`;
}

type SendQueueBase = {
  bySession: Record<string, QueuedSendItem[]>;
  /** Queue item currently loaded into the main composer for editing. */
  editingBySession: Record<string, string | null>;
  /** When true, auto-drain on idle is skipped (immediate-send in progress). */
  suppressDrain: Record<string, boolean>;
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
  pendingSteers: Record<string, QueuedSendItem[]>;
};

type SendQueueDerived = {
  activeItems: QueuedSendItem[];
  /** In-flight guidance for the active session. */
  activePendingSteers: QueuedSendItem[];
  editingId: string | null;
};

function derive(base: SendQueueBase): SendQueueDerived {
  const id = useSessionsStore.getState().activeId;
  return {
    activeItems: id ? base.bySession[id] ?? [] : [],
    activePendingSteers: id ? base.pendingSteers[id] ?? [] : [],
    editingId: id ? base.editingBySession[id] ?? null : null,
  };
}

export type SendQueueState = SendQueueBase &
  SendQueueDerived & {
    list: (sessionId: string) => QueuedSendItem[];
    get: (sessionId: string, id: string) => QueuedSendItem | null;
    setEditing: (sessionId: string, id: string | null) => void;
    enqueue: (
      sessionId: string,
      payload: Omit<QueuedSendItem, "id"> & { id?: string },
    ) => QueuedSendItem;
    addPendingSteer: (
      sessionId: string,
      payload: Omit<QueuedSendItem, "id">,
    ) => QueuedSendItem;
    clearPendingSteers: (sessionId: string) => void;
    updateText: (sessionId: string, id: string, text: string) => void;
    updateItem: (
      sessionId: string,
      id: string,
      payload: Omit<QueuedSendItem, "id">,
    ) => QueuedSendItem | null;
    remove: (sessionId: string, id: string) => QueuedSendItem | null;
    takeNext: (sessionId: string) => QueuedSendItem | null;
    requeueFront: (sessionId: string, item: QueuedSendItem) => void;
    clearSession: (sessionId: string) => void;
    setSuppressDrain: (sessionId: string, value: boolean) => void;
    isDrainSuppressed: (sessionId: string) => boolean;
  };

export const useSendQueueStore = create<SendQueueState>()((set, read) => {
  function commit(patch: Partial<SendQueueBase>): void {
    set((state) => {
      const next = { ...state, ...patch };
      return { ...next, ...derive(next) };
    });
  }

  function list(sessionId: string): QueuedSendItem[] {
    return read().bySession[sessionId] ?? [];
  }

  function get(sessionId: string, id: string): QueuedSendItem | null {
    return list(sessionId).find((i) => i.id === id) ?? null;
  }

  function setEditing(sessionId: string, id: string | null): void {
    commit({ editingBySession: { ...read().editingBySession, [sessionId]: id } });
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
    commit({ bySession: { ...read().bySession, [sessionId]: [...list(sessionId), item] } });
    return item;
  }

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
    const rows = read().pendingSteers[sessionId] ?? [];
    commit({ pendingSteers: { ...read().pendingSteers, [sessionId]: [...rows, item] } });
    return item;
  }

  /** Drop a pending steer once its text shows up in the transcript. */
  function clearPendingSteers(sessionId: string): void {
    if (!read().pendingSteers[sessionId]?.length) return;
    commit({ pendingSteers: { ...read().pendingSteers, [sessionId]: [] } });
  }

  function updateText(sessionId: string, id: string, text: string): void {
    const rows = list(sessionId);
    if (!rows.some((i) => i.id === id)) return;
    commit({
      bySession: {
        ...read().bySession,
        [sessionId]: rows.map((i) => (i.id === id ? { ...i, text } : i)),
      },
    });
  }

  function updateItem(
    sessionId: string,
    id: string,
    payload: Omit<QueuedSendItem, "id">,
  ): QueuedSendItem | null {
    const rows = list(sessionId);
    const row = rows.find((i) => i.id === id);
    if (!row) return null;
    const updated: QueuedSendItem = {
      ...row,
      text: payload.text,
      agentText: payload.agentText,
      images: payload.images?.length ? payload.images.map((i) => ({ ...i })) : undefined,
      citations: payload.citations?.length
        ? payload.citations.map((c) => ({ ...c }))
        : undefined,
      elementTags: payload.elementTags?.length
        ? payload.elementTags.map((t) => ({ ...t }))
        : undefined,
    };
    commit({
      bySession: {
        ...read().bySession,
        [sessionId]: rows.map((i) => (i.id === id ? updated : i)),
      },
    });
    return updated;
  }

  function remove(sessionId: string, id: string): QueuedSendItem | null {
    const rows = list(sessionId);
    const idx = rows.findIndex((i) => i.id === id);
    if (idx < 0) return null;
    const removed = rows[idx] ?? null;
    commit({ bySession: { ...read().bySession, [sessionId]: rows.filter((i) => i.id !== id) } });
    if (read().editingBySession[sessionId] === id) {
      commit({ editingBySession: { ...read().editingBySession, [sessionId]: null } });
    }
    return removed;
  }

  function takeNext(sessionId: string): QueuedSendItem | null {
    const rows = list(sessionId);
    if (!rows.length) return null;
    const next = rows[0] ?? null;
    commit({ bySession: { ...read().bySession, [sessionId]: rows.slice(1) } });
    if (next && read().editingBySession[sessionId] === next.id) {
      commit({ editingBySession: { ...read().editingBySession, [sessionId]: null } });
    }
    return next;
  }

  /** Put an item back at the front after a failed auto-drain send. */
  function requeueFront(sessionId: string, item: QueuedSendItem): void {
    const rows = list(sessionId);
    if (rows.some((row) => row.id === item.id)) return;
    commit({ bySession: { ...read().bySession, [sessionId]: [item, ...rows] } });
  }

  function clearSession(sessionId: string): void {
    const bySession = { ...read().bySession };
    const editingBySession = { ...read().editingBySession };
    const suppressDrain = { ...read().suppressDrain };
    const pendingSteers = { ...read().pendingSteers };
    delete bySession[sessionId];
    delete suppressDrain[sessionId];
    delete editingBySession[sessionId];
    delete pendingSteers[sessionId];
    commit({ bySession, editingBySession, suppressDrain, pendingSteers });
  }

  function setSuppressDrain(sessionId: string, value: boolean): void {
    commit({ suppressDrain: { ...read().suppressDrain, [sessionId]: value } });
  }

  function isDrainSuppressed(sessionId: string): boolean {
    return Boolean(read().suppressDrain[sessionId]);
  }

  const base: SendQueueBase = {
    bySession: {},
    editingBySession: {},
    suppressDrain: {},
    pendingSteers: {},
  };

  return {
    ...base,
    ...derive(base),
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

useSessionsStore.subscribe((state, prev) => {
  if (state.activeId === prev.activeId) return;
  useSendQueueStore.setState((s) => derive(s));
});
