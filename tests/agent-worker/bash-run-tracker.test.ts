import { describe, expect, it, vi } from "vitest";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { createTrackedBashOperations } from "../../src/agent-worker/bash-run-tracker";

function mockBase(opts?: {
  hangUntilAbort?: boolean;
}): BashOperations {
  return {
    exec: async (_command, _cwd, { onData, signal }) => {
      onData(Buffer.from("hello\n"));
      if (opts?.hangUntilAbort) {
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        });
      }
      return { exitCode: 0 };
    },
  };
}

describe("createTrackedBashOperations", () => {
  it("emits start, output, end around base.exec", async () => {
    const events: string[] = [];
    const { operations } = createTrackedBashOperations(mockBase(), {
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: (run) => {
        events.push(`start:${run.command}`);
      },
      onOutput: (runId, chunk) => {
        events.push(`out:${runId}:${chunk}`);
      },
      onEnded: (runId) => {
        events.push(`end:${runId}`);
      },
    });
    await operations.exec("echo hi", "/ws", {
      onData: () => {},
    });
    expect(events[0]).toMatch(/^start:echo hi$/);
    expect(events.some((e) => e.startsWith("out:"))).toBe(true);
    expect(events.at(-1)).toMatch(/^end:/);
  });

  it("terminateRun aborts an in-flight exec", async () => {
    const { operations, terminateRun, getActiveRunIds } = createTrackedBashOperations(
      mockBase({ hangUntilAbort: true }),
      {
        sessionId: "s1",
        workspaceRoot: "/ws",
        onStarted: () => {},
        onOutput: () => {},
        onEnded: () => {},
      },
    );
    const p = operations.exec("sleep", "/ws", { onData: () => {} });
    await vi.waitFor(() => expect(getActiveRunIds().length).toBe(1));
    terminateRun(getActiveRunIds()[0]!);
    await expect(p).rejects.toThrow(/aborted/i);
  });

  it("backgroundRun resolves the tool while keeping the active run until base ends", async () => {
    let release!: () => void;
    const hang = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base: BashOperations = {
      exec: async (_command, _cwd, { onData, signal }) => {
        onData(Buffer.from("boot\n"));
        await hang;
        if (signal?.aborted) throw new Error("aborted");
        return { exitCode: 0 };
      },
    };
    const events: string[] = [];
    const { operations, backgroundRun, getActiveRunIds } = createTrackedBashOperations(base, {
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => events.push("start"),
      onOutput: (_id, chunk) => events.push(`out:${chunk.trim()}`),
      onEnded: () => events.push("end"),
      onBackgrounded: () => events.push("bg"),
    });
    const p = operations.exec("server", "/ws", { onData: () => {} });
    await vi.waitFor(() => expect(getActiveRunIds().length).toBe(1));
    expect(backgroundRun(getActiveRunIds()[0]!)).toBe(true);
    await expect(p).resolves.toEqual({ exitCode: null });
    expect(events).toContain("bg");
    expect(getActiveRunIds().length).toBe(1);
    release();
    await vi.waitFor(() => expect(getActiveRunIds().length).toBe(0));
    expect(events.at(-1)).toBe("end");
  });

  it("shouldStartBackground detaches immediately", async () => {
    const base: BashOperations = {
      exec: async (_command, _cwd, { onData, signal }) => {
        onData(Buffer.from("x\n"));
        await new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
        return { exitCode: 0 };
      },
    };
    const { operations, terminateRun, getActiveRunIds } = createTrackedBashOperations(base, {
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => {},
      onOutput: () => {},
      onEnded: () => {},
      shouldStartBackground: () => true,
    });
    const p = operations.exec("npm run dev", "/ws", { onData: () => {} });
    await expect(p).resolves.toEqual({ exitCode: null });
    await vi.waitFor(() => expect(getActiveRunIds().length).toBe(1));
    terminateRun(getActiveRunIds()[0]!);
    await vi.waitFor(() => expect(getActiveRunIds().length).toBe(0));
  });
});
