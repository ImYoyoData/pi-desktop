import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore, createChatState } from "../../src/renderer/src/stores/chat";
import { useSessionsStore } from "../../src/renderer/src/stores/sessions";
import { useSessionWidgetsStore } from "../../src/renderer/src/stores/session-widgets";
import type { SessionHistoryMessage } from "../../src/shared/protocol";

vi.mock("../../src/renderer/src/services/feedback", () => ({
  getMessage: () => ({
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

const statusMock = vi.fn<() => Promise<"idle" | "running" | null>>();
const historyMock = vi.fn(async () => ({ messages: [] as SessionHistoryMessage[] }));

const DISK_HISTORY: SessionHistoryMessage[] = [
  { id: "u1", role: "user", text: "在吗" },
  { id: "a1", role: "assistant", text: "在的" },
];

function setupEnv(): void {
  useChatStore.setState(useChatStore.getInitialState(), true);
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  useSessionWidgetsStore.setState(useSessionWidgetsStore.getInitialState(), true);
  vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: () => () => undefined,
        onAskUser: () => () => undefined,
        onExtensionUi: () => () => undefined,
        status: statusMock,
        history: historyMock,
      },
      checkpoint: {
        list: async () => [],
        finishActive: async () => null,
      },
      window: { platform: async () => "win32" },
    },
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
}

/** 登记一个活动会话，并让本地进入「正在运行」——模拟事件已丢失的界面。 */
function stageRunningSession(): void {
  useSessionsStore.setState({
    sessions: [
      {
        id: "s1",
        cwd: "c:/ws",
        filePath: "c:/ws/.pi/s1.jsonl",
        status: "running",
        modified: "2026-01-01T00:00:00.000Z",
      },
    ],
    activeId: "s1",
  });
  useChatStore.setState((state) => ({
    bySession: {
      ...state.bySession,
      s1: {
        ...createChatState(),
        running: true,
        turnStartedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    },
  }));
}

describe("chat store resync", () => {
  beforeEach(() => {
    statusMock.mockReset().mockResolvedValue("idle");
    historyMock.mockReset().mockResolvedValue({ messages: DISK_HISTORY });
    setupEnv();
  });

  // 回归：会话事件单向推送且无法补发，丢失后界面会永远停在「等待模型响应」。
  // 主进程已收工时，这里用磁盘历史把会话拉回真实终态。
  it("rebuilds from disk when main is idle but the view still shows running", async () => {
    stageRunningSession();

    await useChatStore.getState().resyncActiveSession();

    const state = useChatStore.getState().bySession.s1;
    expect(state?.running).toBe(false);
    expect(state?.streamingMessage).toBeNull();
    expect(state?.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
    expect(useSessionsStore.getState().sessions[0]?.status).toBe("idle");
  });

  it("leaves a genuinely running turn untouched", async () => {
    stageRunningSession();
    statusMock.mockResolvedValue("running");

    await useChatStore.getState().resyncActiveSession();

    expect(useChatStore.getState().bySession.s1?.running).toBe(true);
    expect(historyMock).not.toHaveBeenCalled();
  });

  it("skips the round-trip entirely when nothing is running locally", async () => {
    useSessionsStore.setState({
      sessions: [
        { id: "s1", cwd: "c:/ws", filePath: "c:/ws/.pi/s1.jsonl", status: "idle", modified: "2026-01-01T00:00:00.000Z" },
      ],
      activeId: "s1",
    });

    await useChatStore.getState().resyncActiveSession();

    expect(statusMock).not.toHaveBeenCalled();
  });

  it("keeps the current view usable when the reconciliation itself fails", async () => {
    stageRunningSession();
    statusMock.mockRejectedValue(new Error("ipc down"));

    await expect(useChatStore.getState().resyncActiveSession()).resolves.toBeUndefined();
    expect(useChatStore.getState().bySession.s1?.running).toBe(true);
  });

  it("does nothing without an active session", async () => {
    await useChatStore.getState().resyncActiveSession();
    expect(statusMock).not.toHaveBeenCalled();
  });
});
