import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, createChatState } from "../../src/renderer/src/stores/chat";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";

vi.mock("../../src/renderer/src/services/feedback", () => ({
  getMessage: () => ({
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const commandMock = vi.fn(async (_sessionId: string, _command: { type: string }) => ({
  ok: true,
}));

const CHECKPOINT = {
  sessionId: "s1",
  userMessageId: "m-2",
  status: "capturing" as const,
  fileCount: 0,
  skippedCount: 0,
};

function setupEnv(): void {
  useChatStore.setState(useChatStore.getInitialState(), true);
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  useSessionWidgetsStore.setState(useSessionWidgetsStore.getInitialState(), true);
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: () => () => undefined,
        onAskUser: () => () => undefined,
        onExtensionUi: () => () => undefined,
        status: async () => "idle",
        history: async () => ({ messages: [] }),
        command: commandMock,
        setUserMessageMeta: async () => undefined,
      },
      checkpoint: {
        list: async () => [],
        begin: async () => CHECKPOINT,
        finishActive: async () => null,
      },
      window: { platform: async () => "win32" },
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
}

describe("重编辑意图的认领时机", () => {
  function setRunning(running: boolean): void {
    useChatStore.setState((state) => {
      const row = state.bySession.s1;
      if (!row) return {};
      return {
        bySession: {
          ...state.bySession,
          s1: {
            ...row,
            running,
            turnStartedAt: running ? Date.now() : null,
            lastActivityAt: Date.now(),
          },
        },
      };
    });
  }

  beforeEach(() => {
    commandMock.mockClear();
    setupEnv();
    useSessionsStore.setState({
      sessions: [
        {
          id: "s1",
          cwd: "c:/ws",
          filePath: "c:/ws/.pi/s1.jsonl",
          status: "idle",
          modified: "2026-01-01T00:00:00.000Z",
        },
      ],
      activeId: "s1",
    });
    useChatStore.setState((state) => ({
      bySession: { ...state.bySession, s1: createChatState() },
    }));
    // 打断后模拟旧轮回包，否则 stopRunBeforeMutation 要等到超时。
    commandMock.mockImplementation(async (_sessionId, command) => {
      if (command.type === "abort") setRunning(false);
      return { ok: true };
    });
  });

  // 回归：停下当前轮会让会话变空闲，自动排空的队列消息会抢先在链上占位，
  // 那时才读 pendingUserEdit 就会被它吃掉 —— 被编辑的气泡换成排队文本。
  it("运行中的重编辑：先认领意图，再发 abort，然后才发新提问", async () => {
    setRunning(true);
    useChatStore.setState({ pendingUserEdit: { sessionId: "s1", messageId: "m-1" } });

    const sending = useChatStore.getState().sendPrompt("s1", "改过的文本");

    expect(useChatStore.getState().pendingUserEdit).toBeNull();

    await sending;

    const types = commandMock.mock.calls.map(([, command]) => command.type);
    expect(types[0]).toBe("abort");
    expect(types.indexOf("prompt")).toBeGreaterThan(0);
  });

  // 空闲时发 abort 没人回收尾事件，残留的停止意图会把下一轮正常结束的待办误标成暂停。
  it("空闲时的重编辑：认领意图但不发 abort", async () => {
    useChatStore.setState({ pendingUserEdit: { sessionId: "s1", messageId: "m-1" } });

    const sending = useChatStore.getState().sendPrompt("s1", "改过的文本");

    expect(useChatStore.getState().pendingUserEdit).toBeNull();

    await sending;

    const types = commandMock.mock.calls.map(([, command]) => command.type);
    expect(types).not.toContain("abort");
    expect(types).toContain("prompt");
  });

  it("普通提问不会动别的会话的重编辑意图", async () => {
    useChatStore.setState({ pendingUserEdit: { sessionId: "s2", messageId: "m-9" } });

    await useChatStore.getState().sendPrompt("s1", "新问题");

    expect(useChatStore.getState().pendingUserEdit).toEqual({
      sessionId: "s2",
      messageId: "m-9",
    });
    const types = commandMock.mock.calls.map(([, command]) => command.type);
    expect(types).not.toContain("abort");
  });
});
