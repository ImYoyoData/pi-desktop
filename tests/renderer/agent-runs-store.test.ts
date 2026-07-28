import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRunSnapshot } from "../../src/shared/agent-runs";
import { useAgentRunsStore } from "../../src/renderer/src/stores/agent-runs";
import { useWorkspaceStore } from "../../src/renderer/src/stores/workspace";

function snap(partial: Partial<AgentRunSnapshot> & Pick<AgentRunSnapshot, "id">): AgentRunSnapshot {
  return {
    sessionId: "sess-1",
    workspaceRoot: "c:/ws/a",
    command: "sleep 30",
    cwd: "c:/ws/a",
    startedAt: 1_000,
    status: "running",
    outputTail: "",
    ...partial,
  };
}

describe("agent-runs store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
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
    const workspace = useWorkspaceStore();
    workspace.root = "C:\\ws\\A";
    const store = useAgentRunsStore();

    store.applyEvent({
      type: "upsert",
      run: snap({ id: "r1", workspaceRoot: "c:/ws/other" }),
    });

    expect(store.runs).toEqual([]);
  });

  it("accepts upsert for current workspace (normalized)", () => {
    const workspace = useWorkspaceStore();
    workspace.root = "C:\\ws\\A\\";
    const store = useAgentRunsStore();
    const run = snap({ id: "r1", workspaceRoot: "c:/ws/a" });

    store.applyEvent({ type: "upsert", run });

    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]?.id).toBe("r1");
    expect(store.selectedId).toBe("r1");
  });

  it("updates outputTail for known run and ignores unknown", () => {
    const workspace = useWorkspaceStore();
    workspace.root = "c:/ws/a";
    const store = useAgentRunsStore();
    store.applyEvent({ type: "upsert", run: snap({ id: "r1" }) });

    store.applyEvent({
      type: "output",
      runId: "missing",
      chunk: "x",
      outputTail: "x",
    });
    expect(store.runs[0]?.outputTail).toBe("");

    store.applyEvent({
      type: "output",
      runId: "r1",
      chunk: "hello",
      outputTail: "hello",
    });
    expect(store.runs[0]?.outputTail).toBe("hello");
  });

  it("removes ended run and reselects", () => {
    const workspace = useWorkspaceStore();
    workspace.root = "c:/ws/a";
    const store = useAgentRunsStore();
    store.applyEvent({ type: "upsert", run: snap({ id: "r1" }) });
    store.applyEvent({ type: "upsert", run: snap({ id: "r2", command: "ping" }) });
    store.select("r1");

    store.applyEvent({ type: "ended", runId: "r1" });

    expect(store.runs.map((r) => r.id)).toEqual(["r2"]);
    expect(store.selectedId).toBe("r2");
  });

  it("filters snapshot to current workspace", () => {
    const workspace = useWorkspaceStore();
    workspace.root = "c:/ws/a";
    const store = useAgentRunsStore();

    store.applyEvent({
      type: "snapshot",
      runs: [
        snap({ id: "keep", workspaceRoot: "c:/ws/a" }),
        snap({ id: "drop", workspaceRoot: "c:/ws/b" }),
      ],
    });

    expect(store.runs.map((r) => r.id)).toEqual(["keep"]);
  });

  it("refresh clears when workspace is null", async () => {
    const workspace = useWorkspaceStore();
    workspace.root = "c:/ws/a";
    const store = useAgentRunsStore();
    store.applyEvent({ type: "upsert", run: snap({ id: "r1" }) });

    await store.refresh(null);
    expect(store.runs).toEqual([]);
    expect(store.selectedId).toBeNull();
  });

  it("ignores stale refresh response after newer workspace refresh", async () => {
    const workspace = useWorkspaceStore();
    workspace.root = "c:/ws/a";
    const store = useAgentRunsStore();
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
    expect(store.runs.map((r) => r.id)).toEqual(["a0"]);

    workspace.root = "c:/ws/b";
    await store.refresh("c:/ws/b");
    expect(store.runs.map((r) => r.id)).toEqual(["b1"]);
    expect(store.selectedId).toBe("b1");

    resolveA([snap({ id: "a1", workspaceRoot: "c:/ws/a" })]);
    await pendingA;

    expect(store.runs.map((r) => r.id)).toEqual(["b1"]);
    expect(store.selectedId).toBe("b1");
  });
});
