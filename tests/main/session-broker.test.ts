import { describe, expect, it } from "vitest";
import { createSessionBroker } from "../../src/main/session-broker";

describe("session-broker", () => {
  it("routes command to the matching session worker only", async () => {
    const hits: string[] = [];
    let seq = 0;
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => {
        seq += 1;
        const id = seq === 1 ? "session-a" : "session-b";
        return {
          id,
          cwd,
          filePath: `/tmp/${id}.jsonl`,
          worker: {
            send: async (msg) => {
              if (msg.kind === "command") hits.push(id);
              return null;
            },
            kill: () => {},
            onMessage: () => () => {},
          },
        };
      },
    });
    const a = await broker.createSession("/tmp/a");
    const b = await broker.createSession("/tmp/a");
    await broker.send(a.id, { type: "ping" });
    expect(hits).toEqual([a.id]);
    expect(b.id).not.toEqual(a.id);
  });
});
