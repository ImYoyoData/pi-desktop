import { describe, expect, it, vi } from "vitest";
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

  it("destroys idle worker after timeout and cold-starts on next send", async () => {
    vi.useFakeTimers();
    let spawnCount = 0;
    let killed = false;
    let messageCb: ((msg: { kind: string }) => void) | null = null;
    const broker = createSessionBroker({
      idleDestroyMs: 60_000,
      spawnWorker: async (cwd) => {
        spawnCount += 1;
        return {
          id: "session-a",
          cwd,
          filePath: "/tmp/session-a.jsonl",
          worker: {
            send: async (msg) => {
              if (msg.kind === "ping") {
                messageCb?.({ kind: "pong" });
              }
              return null;
            },
            kill: () => {
              killed = true;
            },
            onMessage: (cb) => {
              messageCb = cb;
              return () => {
                messageCb = null;
              };
            },
          },
        };
      },
    });
    const session = await broker.createSession("/tmp/a");
    expect(spawnCount).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(killed).toBe(true);
    killed = false;
    await broker.send(session.id, { type: "ping" });
    expect(spawnCount).toBe(2);
    vi.useRealTimers();
  });

  it("rejects pending prompt commands on worker fatal", async () => {
    let messageCb: ((msg: { kind: string; id?: string; error?: string }) => void) | null = null;
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "command" && msg.id) {
              messageCb?.({ kind: "fatal", error: "boom" });
            }
            return null;
          },
          kill: () => {},
          onMessage: (cb) => {
            messageCb = cb;
            return () => {
              messageCb = null;
            };
          },
        },
      }),
    });
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, {
      type: "prompt",
      message: "hi",
    });
    await expect(pending).rejects.toThrow("boom");
  });

  it("rejects pending commands when worker is terminated", async () => {
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "command" && msg.command.type === "hang") {
              return new Promise(() => {});
            }
            return null;
          },
          kill: () => {},
          onMessage: () => () => {},
        },
      }),
    });
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, { type: "hang" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await broker.killWorker(session.id);
    await expect(pending).rejects.toThrow("worker terminated");
  });

  it("emits session_status when heartbeat recovers from stuck to idle", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string; status?: string; sessionId?: string }> = [];
    let messageCb: ((msg: { kind: string }) => void) | null = null;
    let pingCount = 0;
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "ping") {
              pingCount += 1;
              if (pingCount >= 4) {
                messageCb?.({ kind: "pong" });
              }
            }
            return null;
          },
          kill: () => {},
          onMessage: (cb) => {
            messageCb = cb;
            return () => {
              messageCb = null;
            };
          },
        },
      }),
    });
    broker.onEvent((event) => events.push(event));
    const session = await broker.createSession("/tmp/a");
    await vi.advanceTimersByTimeAsync(5_000 * 3);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(true);

    const beforeRecovery = events.length;
    await vi.advanceTimersByTimeAsync(5_000);
    const recovery = events.slice(beforeRecovery);
    expect(recovery).toContainEqual({
      type: "session_status",
      sessionId: session.id,
      status: "idle",
    });
    vi.useRealTimers();
  });

  it("restarts live workers when models/auth change so auth.json is re-read", async () => {
    let spawnCount = 0;
    let killCount = 0;
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => {
        spawnCount += 1;
        return {
          id: "session-a",
          cwd,
          filePath: "/tmp/session-a.jsonl",
          worker: {
            send: async () => null,
            kill: () => {
              killCount += 1;
            },
            onMessage: () => () => {},
          },
        };
      },
    });
    await broker.createSession("/tmp/a");
    expect(spawnCount).toBe(1);
    await broker.notifyWorkersReloadModels();
    expect(killCount).toBe(1);
    expect(spawnCount).toBe(2);
  });
});
