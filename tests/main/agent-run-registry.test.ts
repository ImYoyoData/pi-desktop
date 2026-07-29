import { describe, expect, it, vi } from "vitest";
import { createAgentRunRegistry } from "../../src/main/agent-run-registry";

describe("AgentRunRegistry", () => {
  it("upserts on start, appends output, removes on end", () => {
    const events: unknown[] = [];
    const reg = createAgentRunRegistry({
      onEvent: (e) => events.push(e),
    });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "echo",
        cwd: "/ws",
        startedAt: 1,
      },
    });
    expect(reg.list("/ws")).toHaveLength(1);
    reg.handleWorkerMessage("s1", {
      kind: "run_output",
      runId: "r1",
      chunk: "hi\n",
    });
    expect(reg.list("/ws")[0]!.outputTail).toContain("hi");
    reg.handleWorkerMessage("s1", { kind: "run_ended", runId: "r1" });
    expect(reg.list("/ws")).toHaveLength(0);
    expect(events.some((e: any) => e.type === "ended")).toBe(true);
  });

  it("filters list by workspace root (normalized)", () => {
    const reg = createAgentRunRegistry({ onEvent: () => {} });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "C:\\WS\\A",
        command: "x",
        cwd: "C:\\WS\\A",
        startedAt: 1,
      },
    });
    expect(reg.list("c:/ws/a")).toHaveLength(1);
    expect(reg.list("c:/ws/b")).toHaveLength(0);
  });

  it("endSessionRuns removes all runs for a session", () => {
    const reg = createAgentRunRegistry({ onEvent: () => {} });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "x",
        cwd: "/ws",
        startedAt: 1,
      },
    });
    reg.endSessionRuns("s1");
    expect(reg.list("/ws")).toHaveLength(0);
  });

  it("terminate marks terminating and invokes sender", async () => {
    const send = vi.fn(async () => null);
    const reg = createAgentRunRegistry({
      onEvent: () => {},
      sendTerminate: async (sessionId, runId) => {
        await send(sessionId, runId);
      },
    });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "x",
        cwd: "/ws",
        startedAt: 1,
      },
    });
    await reg.terminate("r1");
    expect(send).toHaveBeenCalledWith("s1", "r1");
    expect(reg.list("/ws")[0]!.status).toBe("terminating");
  });

  it("rolls status back to running when sendTerminate rejects", async () => {
    const events: unknown[] = [];
    const reg = createAgentRunRegistry({
      onEvent: (e) => events.push(e),
      sendTerminate: async () => {
        throw new Error("worker unavailable");
      },
    });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "x",
        cwd: "/ws",
        startedAt: 1,
      },
    });
    await expect(reg.terminate("r1")).rejects.toThrow("worker unavailable");
    expect(reg.list("/ws")[0]!.status).toBe("running");
    const upserts = events.filter((e: any) => e.type === "upsert") as Array<{
      type: string;
      run: { status: string };
    }>;
    expect(upserts.at(-1)?.run.status).toBe("running");
  });

  it("preserves outputTail when run_started is re-emitted with pid", () => {
    const reg = createAgentRunRegistry({ onEvent: () => {} });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "npm run dev",
        cwd: "/ws",
        startedAt: 1,
      },
    });
    reg.handleWorkerMessage("s1", {
      kind: "run_output",
      runId: "r1",
      chunk: "boot\n",
    });
    expect(reg.list("/ws")[0]!.outputTail).toBe("boot\n");

    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "npm run dev",
        cwd: "/ws",
        startedAt: 1,
        pid: 4242,
      },
    });
    const row = reg.list("/ws")[0]!;
    expect(row.pid).toBe(4242);
    expect(row.outputTail).toBe("boot\n");
  });

  it("coalesces rapid output into fewer IPC events", async () => {
    vi.useFakeTimers();
    const events: unknown[] = [];
    const reg = createAgentRunRegistry({
      onEvent: (e) => events.push(e),
    });
    reg.handleWorkerMessage("s1", {
      kind: "run_started",
      run: {
        id: "r1",
        sessionId: "s1",
        workspaceRoot: "/ws",
        command: "x",
        cwd: "/ws",
        startedAt: 1,
      },
    });
    reg.handleWorkerMessage("s1", { kind: "run_output", runId: "r1", chunk: "a" });
    reg.handleWorkerMessage("s1", { kind: "run_output", runId: "r1", chunk: "b" });
    reg.handleWorkerMessage("s1", { kind: "run_output", runId: "r1", chunk: "c" });
    expect(events.filter((e: any) => e.type === "output")).toHaveLength(0);
    expect(reg.list("/ws")[0]!.outputTail).toBe("abc");

    await vi.advanceTimersByTimeAsync(40);
    const outs = events.filter((e: any) => e.type === "output") as Array<{
      type: string;
      chunk: string;
      outputTail: string;
    }>;
    expect(outs).toHaveLength(1);
    expect(outs[0]!.chunk).toBe("abc");
    expect(outs[0]!.outputTail).toBe("abc");
    vi.useRealTimers();
  });
});
