import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapAppEvents, isAppEventsBound } from "../../src/renderer/src/app-events";
import { useChatStore } from "../../src/renderer/src/stores/chat";
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

type Listener = (event: unknown) => void;

// fs-changed-bus 在模块顶层就读 window，必须赶在 import 之前把全局打好。
vi.hoisted(() => {
  vi.stubGlobal("window", { api: { window: { platform: async () => "win32" } } });
});

const sessionListeners: Listener[] = [];
const runListeners: Listener[] = [];

function emitSession(event: unknown): void {
  for (const cb of sessionListeners) cb(event);
}

function resetStores(): void {
  useChatStore.setState(useChatStore.getInitialState(), true);
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  useSessionWidgetsStore.setState(useSessionWidgetsStore.getInitialState(), true);
}

function setupEnv(): void {
  sessionListeners.length = 0;
  runListeners.length = 0;
  resetStores();
  vi.stubGlobal("document", {
    hidden: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("window", {
    api: {
      sessions: {
        onEvent: (cb: Listener) => {
          sessionListeners.push(cb);
          return () => undefined;
        },
        onAskUser: () => () => undefined,
        onExtensionUi: () => () => undefined,
        pendingUi: async () => ({ asks: [], extensionDialogs: [] }),
        status: async () => null,
        history: async () => ({ messages: [] }),
      },
      checkpoint: { onUpdated: () => () => undefined },
      runs: {
        onEvent: (cb: Listener) => {
          runListeners.push(cb);
          return () => undefined;
        },
        list: async () => [],
      },
      fs: { onChanged: () => () => undefined },
      notify: { onOpenSession: () => () => undefined },
      window: { platform: async () => "win32" },
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
}

describe("app-events", () => {
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    setupEnv();
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    vi.unstubAllGlobals();
  });

  it("registers process-wide subscriptions once and reports bound state", () => {
    expect(isAppEventsBound()).toBe(false);
    teardown = bootstrapAppEvents();
    expect(isAppEventsBound()).toBe(true);
    // chat / sessions 各注册一个会话事件 listener，runs 注册一个运行事件 listener。
    expect(sessionListeners).toHaveLength(2);
    expect(runListeners).toHaveLength(1);
  });

  it("is idempotent — repeated bootstrap does not stack listeners", () => {
    teardown = bootstrapAppEvents();
    const again = bootstrapAppEvents();
    expect(again).toBe(teardown);
    expect(sessionListeners).toHaveLength(2);
    expect(runListeners).toHaveLength(1);
  });

  // 回归：订阅曾挂在 ChatPanel 的组件 scope 上，而 ChatPanel 会被 `v-if` 反复
  // 销毁重建（切到拉取请求视图即卸载）。卸载后事件被静默丢弃，界面永久停在
  // 「等待模型响应」，而后端与模型都正常。
  it("keeps delivering session events without any component involvement", () => {
    teardown = bootstrapAppEvents();

    emitSession({
      type: "agent_event",
      sessionId: "s1",
      event: { type: "agent_start" },
    });

    expect(useChatStore.getState().bySession.s1?.running).toBe(true);
    expect(useSessionsStore.getState().sessions).toHaveLength(0); // 未登记会话，状态不落地
  });

  it("unbind tears everything down and a later bootstrap rebinds cleanly", () => {
    teardown = bootstrapAppEvents();
    teardown();
    expect(isAppEventsBound()).toBe(false);

    teardown = bootstrapAppEvents();
    expect(sessionListeners).toHaveLength(4);
    expect(runListeners).toHaveLength(2);
  });
});
