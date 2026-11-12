import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerInbound } from "../../src/shared/agent-worker-messages";

type ParentPortLike = { postMessage: (msg: unknown) => void };

function installParentPort(postMessage: (msg: unknown) => void): void {
  (process as unknown as { parentPort?: ParentPortLike }).parentPort = { postMessage };
}

describe("agent-worker runtime dispatch", () => {
  afterEach(() => {
    delete (process as unknown as { parentPort?: ParentPortLike }).parentPort;
    vi.restoreAllMocks();
  });

  it("routes a ping command and posts the result", async () => {
    const postMessage = vi.fn();
    installParentPort(postMessage);
    const { handleWorkerMessage } = await import("../../src/agent-worker/runtime");
    await handleWorkerMessage({
      kind: "command",
      id: "turn-1",
      command: { type: "ping" },
    } as WorkerInbound);
    expect(postMessage).toHaveBeenCalledWith({
      kind: "result",
      id: "turn-1",
      data: { ok: true },
    });
  });

  it("ignores messages with an unknown kind", async () => {
    installParentPort(vi.fn());
    const { handleWorkerMessage } = await import("../../src/agent-worker/runtime");
    await expect(
      handleWorkerMessage({ kind: "not-a-real-kind" } as unknown as WorkerInbound),
    ).resolves.toBeUndefined();
  });
});
