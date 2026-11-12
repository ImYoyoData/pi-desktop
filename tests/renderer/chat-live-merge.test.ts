import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, createChatState } from "../../src/renderer/src/stores/chat";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";
import { useCheckpointStore } from "../../src/renderer/src/stores/checkpoint";
import type { SessionHistoryMessage } from "../../src/shared/protocol";

vi.mock("../../src/renderer/src/services/feedback", () => ({
  getMessage: () => ({
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

function setupEnv(): void {
  useChatStore.setState(useChatStore.getInitialState(), true);
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  useSessionWidgetsStore.setState(useSessionWidgetsStore.getInitialState(), true);
  useCheckpointStore.setState(useCheckpointStore.getInitialState(), true);
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: () => () => undefined,
        onAskUser: () => () => undefined,
        onExtensionUi: () => () => undefined,
      },
      checkpoint: { list: async () => [] },
      window: { platform: async () => "win32" },
    },
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
}

describe("live history merge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    setupEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not duplicate an image-only turn already on disk", () => {
    useChatStore.setState((state) => ({
      bySession: {
        ...state.bySession,
        s1: {
          ...createChatState(),
          running: true,
          messages: [
            { id: "local-user", role: "user", text: "", agentText: " " },
            { id: "a1", role: "assistant", text: "done" },
          ],
        },
      },
    }));
    const disk: SessionHistoryMessage[] = [
      { id: "u1", role: "user", text: "" },
      { id: "a2", role: "assistant", text: "done" },
    ];
    useChatStore.getState().hydrateFromHistory("s1", disk, false);
    const ids = useChatStore.getState().bySession.s1!.messages.map((m) => m.id);
    expect(ids).toEqual(["local-user", "a1"]);
  });

  it("appends the live tail when the prompt has not reached disk yet", () => {
    useChatStore.setState((state) => ({
      bySession: {
        ...state.bySession,
        s1: {
          ...createChatState(),
          running: true,
          messages: [
            { id: "u0", role: "user", text: "first" },
            { id: "a0", role: "assistant", text: "one" },
            { id: "local-user", role: "user", text: "second" },
          ],
        },
      },
    }));
    const disk: SessionHistoryMessage[] = [
      { id: "u0", role: "user", text: "first" },
      { id: "a0", role: "assistant", text: "one" },
    ];
    useChatStore.getState().hydrateFromHistory("s1", disk, false);
    const ids = useChatStore.getState().bySession.s1!.messages.map((m) => m.id);
    expect(ids).toEqual(["u0", "a0", "local-user"]);
  });

  it("keeps older loaded pages when the disk tail re-anchors by prompt", () => {
    useChatStore.setState((state) => ({
      bySession: {
        ...state.bySession,
        s1: {
          ...createChatState(),
          running: true,
          messages: [
            { id: "h0", role: "user", text: "older" },
            { id: "u1", role: "user", text: "hello" },
            { id: "local-user", role: "user", text: "hello" },
            { id: "a1", role: "assistant", text: "done" },
          ],
        },
      },
    }));
    const disk: SessionHistoryMessage[] = [
      { id: "u1", role: "user", text: "hello" },
      { id: "u1-answer", role: "assistant", text: "done" },
    ];
    useChatStore.getState().hydrateFromHistory("s1", disk, true);
    const ids = useChatStore.getState().bySession.s1!.messages.map((m) => m.id);
    expect(ids).toEqual(["h0", "local-user", "a1"]);
  });

  it("keeps older loaded pages when the disk tail anchors mid-live", () => {
    useChatStore.setState((state) => ({
      bySession: {
        ...state.bySession,
        s1: {
          ...createChatState(),
          running: true,
          messages: [
            { id: "h0", role: "user", text: "older" },
            { id: "u1", role: "user", text: "hello" },
            { id: "a1", role: "assistant", text: "done" },
            { id: "b1", role: "assistant", text: "more" },
          ],
        },
      },
    }));
    const disk: SessionHistoryMessage[] = [
      { id: "u1", role: "user", text: "hello" },
      { id: "a1", role: "assistant", text: "done" },
    ];
    useChatStore.getState().hydrateFromHistory("s1", disk, true);
    const ids = useChatStore.getState().bySession.s1!.messages.map((m) => m.id);
    expect(ids).toEqual(["h0", "u1", "a1", "b1"]);
  });
});
