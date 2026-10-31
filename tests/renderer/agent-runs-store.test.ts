import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunSnapshot } from "../../src/shared/agent-runs";
import { useAgentRunsStore } from "../../src/renderer/src/stores/agent-runs";
import { useWorkspaceStore } from "../../src/renderer/src/stores/workspace";

vi.mock("../../src/renderer/src/services/feedback", () => ({
  getMessage: () => ({
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  }),
}));

function snap(partial: Partial<AgentRunSnapshot> & Pick<AgentRunSnapshot, "id">): AgentRunSnapshot {
  return {
    sessionId: "sess-1",
    workspaceRoot: "c:/ws/a",
    command: "sleep 30",
    cwd: "c:/ws/a",
    startedAt: 1_000,
    status: "running",
    outputTail: "",
    lastOutputAt: 1_000,
    ...partial,
  };
}

function state() {
  return useAgentRunsStore.getState();
}

function setWorkspaceRoot(root: string | null): void {
  useWorkspaceStore.setState({ root });
}

describe("agent-runs store", () => {
  beforeEach(() => {
    useAgentRunsStore.setState(useAgentRunsStore.getInitialState(), true);
    setWorkspaceRoot(null);
    vi.stubGlobal("window", {
      api: {
        runs: {
          list: vi.fn(async () => []),
          terminate: vi.fn(async () => undefined),
          onEvent: vi.fn(() => () => undefined),
        },
        fs: {
          watch: vi.fn(async () => ({ ok: true })),
          unwatch: vi.fn(async () => ({ ok: true })),
        },
        workspace: {
          get: vi.fn(async () => null),
          open: vi.fn(async () => null),
          openPath: vi.fn(async () => null),
          listRecent: vi.fn(async () => []),
          removeRecent: vi.fn(async () => ({ root: null, recent: [] })),
          revealInFolder: vi.fn(async () => undefined),
        },
      },
    });
  });

  it("ignores upsert from a different workspace", () => {
    setWorkspaceRoot("C:\\ws\\A");
    const store = state();

    store.applyEvent({
      type: "upsert",
      run: snap({ id: "r1", workspaceRoot: "c:/ws/other" }),
    });

    expect(state().runs).toEqual([]);
  });

  it("accepts upsert for current workspace (normalized)", () => {
    setWorkspaceRoot("C:\\ws\\A\\");
    const store = state();
    const run = snap({ id: "r1", workspaceRoot: "c:/ws/a" });

    store.applyEvent({ type: "upsert", run });

    expect(state().runs).toHaveLength(1);
    expect(state().runs[0]?.id).toBe("r1");
    expect(state().selectedId).toBe("r1");
  });

  it("updates outputTail for known run and ignores unknown", () => {
    setWorkspaceRoot("c:/ws/a");
    const store = state();
    store.applyEvent({ type: "upsert", run: snap({ id: "r1" }) });

    store.applyEvent({
      type: "output",
      runId: "missing",
      chunk: "x",
      outputTail: "x",
    });
    expect(state().runs[0]?.outputTail).toBe("");

    const before = Date.now();
    store.applyEvent({
      type: "output",
      runId: "r1",
      chunk: "hello",
      outputTail: "hello",
    });
    expect(state().runs[0]?.outputTail).toBe("hello");
    expect(state().runs[0]?.lastOutputAt).toBeGreaterThanOrEqual(before);
  });

  it("checkBashStalls terminates silent running bash once", async () => {
    vi.useFakeTimers();
    setWorkspaceRoot("c:/ws/a");
    const store = state();
    const terminate = vi.mocked(window.api.runs.terminate);
    store.applyEvent({
      type: "upsert",
      run: snap({
        id: "r1",
        startedAt: Date.now() - 130_000,
        lastOutputAt: Date.now() - 130_000,
      }),
    });

    store.checkBashStalls();
    store.checkBashStalls();
    await Promise.resolve();

    expect(terminate).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledWith("r1");
    vi.useRealTimers();
  });

  it("removes ended run and reselects", () => {
    setWorkspaceRoot("c:/ws/a");
    const store = state();
    store.applyEvent({ type: "upsert", run: snap({ id: "r1" }) });
    store.applyEvent({ type: "upsert", run: snap({ id: "r2", command: "ping" }) });
    store.select("r1");

    store.applyEvent({ type: "ended", runId: "r1" });

    expect(state().runs.map((r) => r.id)).toEqual(["r2"]);
    expect(state().selectedId).toBe("r2");
  });

  it("filters snapshot to current workspace", () => {
    setWorkspaceRoot("c:/ws/a");
    const store = state();

    store.applyEvent({
      type: "snapshot",
      runs: [
        snap({ id: "keep", workspaceRoot: "c:/ws/a" }),
        snap({ id: "drop", workspaceRoot: "c:/ws/b" }),
      ],
    });

    expect(state().runs.map((r) => r.id)).toEqual(["keep"]);
  });

  it("refresh clears when workspace is null", async () => {
    setWorkspaceRoot("c:/ws/a");
    const store = state();
    store.applyEvent({ type: "upsert", run: snap({ id: "r1" }) });

    await store.refresh(null);
    expect(state().runs).toEqual([]);
    expect(state().selectedId).toBeNull();
  });

  it("ignores stale refresh response after newer workspace refresh", async () => {
    setWorkspaceRoot("c:/ws/a");
    const store = state();
    store.applyEvent({
      type: "upsert",
      run: snap({ id: "a0", workspaceRoot: "c:/ws/a" }),
    });

    let resolveA!: (value: AgentRunSnapshot[]) => void;
    const listA = new Promise<AgentRunSnapshot[]>((resolve) => {
      resolveA = resolve;
    });
    const listFn = vi.mocked(window.api.runs.list);
    listFn.mockImplementationOnce(() => listA);
    listFn.mockImplementationOnce(async () => [
      snap({ id: "b1", workspaceRoot: "c:/ws/b" }),
    ]);

    const pendingA = store.refresh("c:/ws/a");
    expect(state().runs.map((r) => r.id)).toEqual(["a0"]);

    setWorkspaceRoot("c:/ws/b");
    await store.refresh("c:/ws/b");
    expect(state().runs.map((r) => r.id)).toEqual(["b1"]);
    expect(state().selectedId).toBe("b1");

    resolveA([snap({ id: "a1", workspaceRoot: "c:/ws/a" })]);
    await pendingA;

    expect(state().runs.map((r) => r.id)).toEqual(["b1"]);
    expect(state().selectedId).toBe("b1");
  });

  // 回归 #49：休眠唤醒后墙钟跳过数小时，看门狗第一个 tick 会把正在跑的命令
  // 全判成卡死并终止。
  it("gives running commands a grace window instead of killing them right after a suspend", async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    setWorkspaceRoot("c:/ws/a");
    const store = state();
    const terminate = vi.mocked(window.api.runs.terminate);
    store.applyEvent({
      type: "upsert",
      run: snap({
        id: "r-suspend",
        startedAt: Date.now() - 130_000,
        lastOutputAt: Date.now() - 10_000,
      }),
    });
    store.bind();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(terminate).not.toHaveBeenCalled();

    // 休眠 1h：墙钟前进，唤醒后定时器只补跑一个 tick。
    vi.setSystemTime(Date.now() + 3_600_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(terminate).not.toHaveBeenCalled();

    // 宽限用尽后判定照旧：真卡死的命令仍会被终止。
    await vi.advanceTimersByTimeAsync(130_000);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledWith("r-suspend");
    store.unbind();
    vi.useRealTimers();
  });
});
