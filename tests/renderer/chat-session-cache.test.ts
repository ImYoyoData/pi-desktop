import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, createChatState } from "../../src/renderer/src/stores/chat";
import { useCheckpointStore } from "../../src/renderer/src/stores/checkpoint";
import type { SessionHistoryMessage } from "../../src/shared/protocol";

vi.mock("naive-ui", () => ({
  createDiscreteApi: () => ({
    message: { warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  }),
}));

/** 常驻上限与 chat store 内部一致，超出后最久未使用的会话应被驱逐。 */
const MAX_CACHED_SESSIONS = 8;

let clock = 0;

function setupEnv(): void {
  setActivePinia(createPinia());
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

function historyOf(index: number): SessionHistoryMessage[] {
  return [{ id: `u${index}`, role: "user", text: `msg ${index}` }];
}

/** 按顺序 hydrate n 个会话，每次推进时钟以形成确定的 LRU 顺序。 */
function hydrateRange(count: number): void {
  const chat = useChatStore();
  for (let i = 0; i < count; i++) {
    clock += 1_000;
    vi.setSystemTime(clock);
    chat.hydrateFromHistory(`s${i}`, historyOf(i));
  }
}

describe("chat session cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 1_000_000;
    vi.setSystemTime(clock);
    setupEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps everything while under the cap", () => {
    hydrateRange(MAX_CACHED_SESSIONS);
    const chat = useChatStore();
    expect(Object.keys(chat.bySession)).toHaveLength(MAX_CACHED_SESSIONS);
  });

  // 回归：bySession 原本只在删除会话时清理，切走但没删的会话会带着全量历史
  // 永久常驻渲染进程堆，长时间使用后 OOM。
  it("evicts least-recently-used sessions once over the cap", () => {
    hydrateRange(MAX_CACHED_SESSIONS + 4);
    const ids = Object.keys(useChatStore().bySession);
    expect(ids).toHaveLength(MAX_CACHED_SESSIONS);
    // 最后 4 个最晚进入，最早的 4 个被驱逐。
    expect(ids).not.toContain("s0");
    expect(ids).not.toContain("s3");
    expect(ids).toContain(`s${MAX_CACHED_SESSIONS + 3}`);
  });

  it("never evicts the session just hydrated", () => {
    hydrateRange(MAX_CACHED_SESSIONS + 2);
    const ids = Object.keys(useChatStore().bySession);
    expect(ids).toContain(`s${MAX_CACHED_SESSIONS + 1}`);
  });

  it("refuses to evict a session with a live turn (streamed tail is the only truth)", () => {
    const chat = useChatStore();
    clock += 1_000;
    vi.setSystemTime(clock);
    chat.hydrateFromHistory("busy", historyOf(0));
    chat.bySession.busy = { ...createChatState(), running: true, streamingMessage: null };
    hydrateRange(MAX_CACHED_SESSIONS + 2);
    expect(useChatStore().bySession.busy).toBeDefined();
  });

  it("drops the evicted session's checkpoint records too", () => {
    const chat = useChatStore();
    const checkpoint = useCheckpointStore();
    clock += 1_000;
    vi.setSystemTime(clock);
    chat.hydrateFromHistory("old", historyOf(0));
    checkpoint.byKey["old::u1"] = {
      sessionId: "old",
      userMessageId: "u1",
      status: "ready",
      fileCount: 3,
      skippedCount: 0,
    };
    checkpoint.byKey["old::u2"] = {
      sessionId: "old",
      userMessageId: "u2",
      status: "empty",
      fileCount: 0,
      skippedCount: 0,
    };

    hydrateRange(MAX_CACHED_SESSIONS);

    expect(useChatStore().bySession.old).toBeUndefined();
    expect(checkpoint.byKey["old::u1"]).toBeUndefined();
    expect(checkpoint.byKey["old::u2"]).toBeUndefined();
  });

  it("keeps checkpoint records belonging to a surviving session", () => {
    const chat = useChatStore();
    const checkpoint = useCheckpointStore();
    hydrateRange(MAX_CACHED_SESSIONS);
    // s7 是最近 hydrate 的，会话本轮存活，其检查点不该被连带清理。
    checkpoint.byKey["s7::u1"] = {
      sessionId: "s7",
      userMessageId: "u1",
      status: "ready",
      fileCount: 1,
      skippedCount: 0,
    };

    clock += 1_000;
    vi.setSystemTime(clock);
    chat.hydrateFromHistory("s-new", historyOf(99));

    expect(checkpoint.byKey["s7::u1"]).toBeDefined();
  });
});