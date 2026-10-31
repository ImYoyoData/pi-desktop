import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../src/shared/protocol";
import { createChatState, useChatStore } from "../../src/renderer/src/stores/chat";
import type { ChatMessage } from "../../src/renderer/src/stores/chat-reducer";
import { useCheckpointStore } from "../../src/renderer/src/stores/checkpoint";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";

vi.mock("../../src/renderer/src/services/feedback", () => ({
  getMessage: () => ({
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const commandMock = vi.fn(async (..._args: unknown[]) => null);
const restartMock = vi.fn(async (_sessionId: string) => undefined);

function setupEnv(): void {
  useChatStore.setState(useChatStore.getInitialState(), true);
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  useSessionWidgetsStore.setState(useSessionWidgetsStore.getInitialState(), true);
  useCheckpointStore.setState(useCheckpointStore.getInitialState(), true);
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: (_cb: (event: AgentEvent) => void) => () => undefined,
        onAskUser: () => () => undefined,
        onExtensionUi: () => () => undefined,
        onPermission: () => () => undefined,
        pendingUi: async () => null,
        command: commandMock,
        restartWorker: restartMock,
      },
      checkpoint: {
        onUpdated: () => () => undefined,
        begin: async (sessionId: string, userMessageId: string) => ({
          sessionId,
          userMessageId,
          status: "empty",
          fileCount: 0,
          skippedCount: 0,
        }),
        finishActive: async () => null,
        list: async () => [],
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

function stageSession(sessionId: string, patch: Partial<ReturnType<typeof createChatState>>): void {
  const messages: ChatMessage[] = patch.messages ?? [];
  useChatStore.setState((state) => ({
    bySession: {
      ...state.bySession,
      [sessionId]: { ...createChatState(), ...patch, messages },
    },
  }));
}

describe("chat auto-recover after a system suspend", () => {
  beforeEach(() => {
    commandMock.mockClear();
    restartMock.mockClear();
    setupEnv();
  });

  // 回归 #49：休眠唤醒后墙钟跳过数小时，看门狗第一个 tick 会把整轮判成事件循环卡死，
  // 于是重启 worker 并重发上一条消息。
  it("skips the first watchdog tick after a suspend instead of restarting the worker", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    const now = Date.now();
    stageSession("s-suspend", {
      running: true,
      turnStartedAt: now,
      lastActivityAt: now,
      lastWorkerAliveAt: now,
      messages: [{ id: "u1", role: "user", text: "跑个测试" }],
    });

    const unbind = useChatStore.getState().bindEvents();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restartMock).not.toHaveBeenCalled();

    // 休眠 1h：墙钟前进，唤醒后定时器只补跑一个 tick。
    vi.setSystemTime(Date.now() + 3_600_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    expect(restartMock).not.toHaveBeenCalled();
    expect(commandMock).not.toHaveBeenCalled();
    unbind();
    vi.useRealTimers();
  });

  it("never resends the last user message for a session that is not running", async () => {
    stageSession("s-idle", {
      running: false,
      messages: [
        { id: "u1", role: "user", text: "在吗" },
        { id: "a1", role: "assistant", text: "在的" },
      ],
    });

    const recovered = await useChatStore.getState().autoRecover("s-idle", "worker_stuck");

    expect(recovered).toBe(false);
    expect(restartMock).not.toHaveBeenCalled();
    expect(commandMock).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession["s-idle"]?.messages).toHaveLength(2);
  });

  it("still restarts and resends a genuinely running turn", async () => {    const now = Date.now();
    stageSession("s-live", {
      running: true,
      turnStartedAt: now,
      lastActivityAt: now,
      lastWorkerAliveAt: now,
      messages: [{ id: "u9", role: "user", text: "跑个测试" }],
    });

    const recovered = await useChatStore.getState().autoRecover("s-live", "stall");

    expect(recovered).toBe(true);
    expect(restartMock).toHaveBeenCalledWith("s-live");
    expect(commandMock).toHaveBeenCalledTimes(1);
    const command = commandMock.mock.calls[0]?.[1] as { type?: string } | undefined;
    expect(command?.type).toBe("prompt");
  });

  // 修复不能变成永不判定：唤醒 tick 重置基准后，真卡死（75s 无输出无心跳）仍要恢复。
  it("still recovers a genuinely stalled turn after the wake-up tick", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const now = Date.now();
    stageSession("s-stalled", {
      running: true,
      turnStartedAt: now,
      lastActivityAt: now,
      lastWorkerAliveAt: now,
      messages: [{ id: "u5", role: "user", text: "跑个测试" }],
    });

    const unbind = useChatStore.getState().bindEvents();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(restartMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(80_000);

    expect(restartMock).toHaveBeenCalledWith("s-stalled");
    unbind();
    vi.useRealTimers();
  });
});
