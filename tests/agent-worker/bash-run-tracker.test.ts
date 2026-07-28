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
});
