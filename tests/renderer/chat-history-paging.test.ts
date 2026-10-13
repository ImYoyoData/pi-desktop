import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../../src/renderer/src/stores/chat";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";
import type { SessionHistoryMessage, SessionHistoryPage } from "../../src/shared/protocol";

vi.mock("naive-ui", () => ({
  createDiscreteApi: () => ({
    message: { warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  }),
}));

const historyMock = vi.fn(async (): Promise<SessionHistoryPage> => ({
  messages: [],
  hasMore: false,
  total: 0,
}));

function setupEnv(): void {
  setActivePinia(createPinia());
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: () => () => undefined,
        onAskUser: () => () => undefined,
        onExtensionUi: () => () => undefined,
        history: historyMock,
      },
      checkpoint: { list: async () => [] },
      window: { platform: async () => "win32" },
    },
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
}

/** 造 n 条 user 消息，id 前缀为 tag。 */
function page(tag: string, n: number): SessionHistoryMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${tag}${i}`,
    role: "user" as const,
    text: `${tag}${i}`,
  }));
}

/** 登记会话并把最近一页灌进 chat store。 */
function stage(tag: string, n: number, hasMore: boolean): void {
  useSessionsStore().sessions = [
    {
      id: "s1",
      cwd: "c:/ws",
      filePath: "c:/ws/.pi/s1.jsonl",
      status: "idle",
      modified: "2026-01-01T00:00:00.000Z",
    },
  ];
  useChatStore().hydrateFromHistory("s1", page(tag, n), hasMore);
}

const ids = (tag: string, n: number) => page(tag, n).map((m) => m.id);

describe("chat history paging", () => {
  beforeEach(() => {
    historyMock.mockReset().mockResolvedValue({ messages: [], hasMore: false, total: 0 });
    setupEnv();
  });

  it("records the cursor from the oldest loaded message", () => {
    stage("a", 3, true);
    const older = useChatStore().olderBySession.s1;
    expect(older?.hasMore).toBe(true);
    expect(older?.cursor).toBe("a0");
    expect(older?.loading).toBe(false);
  });

  it("defaults to no older history when the caller does not say", () => {
    stage("a", 3, false);
    expect(useChatStore().olderBySession.s1?.hasMore).toBe(false);
  });

  it("prepends an older page in front of the loaded tail", async () => {
    stage("a", 3, true);
    historyMock.mockResolvedValue({ messages: page("b", 2), hasMore: false, total: 5 });
    const chat = useChatStore();

    const added = await chat.loadOlderMessages("s1");

    expect(added).toBe(2);
    expect(chat.bySession.s1?.messages.map((m) => m.id)).toEqual([
      ...ids("b", 2),
      ...ids("a", 3),
    ]);
    expect(chat.olderBySession.s1).toMatchObject({ hasMore: false, cursor: "b0" });
  });

  it("passes the cursor as beforeId so the main process returns strictly older rows", async () => {
    stage("a", 3, true);
    historyMock.mockResolvedValue({ messages: page("b", 2), hasMore: false, total: 5 });

    await useChatStore().loadOlderMessages("s1");

    expect(historyMock).toHaveBeenCalledWith("c:/ws/.pi/s1.jsonl", {
      limit: expect.any(Number),
      beforeId: "a0",
    });
  });

  it("skips the round-trip when there is nothing older left", async () => {
    stage("a", 3, false);
    expect(await useChatStore().loadOlderMessages("s1")).toBe(0);
    expect(historyMock).not.toHaveBeenCalled();
  });

  it("treats an empty page as the end of history instead of retrying forever", async () => {
    stage("a", 3, true);
    historyMock.mockResolvedValue({ messages: [], hasMore: true, total: 9 });

    expect(await useChatStore().loadOlderMessages("s1")).toBe(0);
    expect(useChatStore().olderBySession.s1?.hasMore).toBe(false);
  });

  it("keeps the backlog on IPC failure so a retry can still work", async () => {
    stage("a", 3, true);
    historyMock.mockRejectedValue(new Error("ipc down"));
    const chat = useChatStore();

    expect(await chat.loadOlderMessages("s1")).toBe(0);
    expect(chat.olderBySession.s1).toMatchObject({ hasMore: true, loading: false });
    expect(chat.bySession.s1?.messages).toHaveLength(3);
  });

  it("blocks a second concurrent request for the same session", async () => {
    stage("a", 3, true);
    let release: () => void = () => {};
    historyMock.mockImplementation(
      () =>
        new Promise<SessionHistoryPage>((resolve) => {
          release = () => resolve({ messages: page("b", 2), hasMore: false, total: 5 });
        }),
    );
    const chat = useChatStore();

    const first = chat.loadOlderMessages("s1");
    expect(chat.olderBySession.s1?.loading).toBe(true);
    expect(await chat.loadOlderMessages("s1")).toBe(0);
    expect(historyMock).toHaveBeenCalledTimes(1);

    release();
    expect(await first).toBe(2);
  });

  it("drops the cursor when the session state is cleared", () => {
    stage("a", 3, true);
    const chat = useChatStore();
    chat.clearSession("s1");
    expect(chat.olderBySession.s1).toBeUndefined();
  });
});