import { describe, expect, it } from "vitest";
import { createSessionBroker } from "../../src/main/session-broker";

describe("session-broker", () => {
  it("routes command to the matching session worker only", async () => {
    const hits: string[] = [];
    const broker = createSessionBroker({
      spawnWorker: async (sessionId) => ({
        send: async (msg) => {
          if (msg.kind === "command") hits.push(sessionId);
          return null;
        },
        kill: () => {},
        onMessage: () => () => {},
      }),
    });
    const a = await broker.createSession("/tmp/a");
    const b = await broker.createSession("/tmp/a");
    await broker.send(a.id, { type: "ping" });
    expect(hits).toEqual([a.id]);
    expect(b.id).not.toEqual(a.id);
  });
});
