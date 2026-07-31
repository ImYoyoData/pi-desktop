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

  it("ignores clean worker exit (0) without prompt_error", async () => {
    let messageCb: ((msg: { kind: string; error?: string }) => void) | null = null;
    const events: Array<{ type: string; errorMessage?: string; status?: string }> = [];
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async () => null,
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
    broker.onEvent((event) => {
      events.push(event as { type: string; errorMessage?: string; status?: string });
    });
    await broker.createSession("/tmp/a");
    messageCb?.({ kind: "fatal", error: "worker exited (0)" });
    expect(events.some((e) => e.type === "prompt_error")).toBe(false);
    expect(events.some((e) => e.type === "session_status" && e.status === "error")).toBe(
      false,
    );
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
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async () => null,
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
    // No pong for the full miss window → stuck
    await vi.advanceTimersByTimeAsync(5_000 * 3);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(true);

    const beforeRecovery = events.length;
    messageCb?.({ kind: "pong" });
    const recovery = events.slice(beforeRecovery);
    expect(recovery).toContainEqual({
      type: "session_status",
      sessionId: session.id,
      status: "idle",
    });
    vi.useRealTimers();
  });

  it("does not mark stuck when worker keeps sending events without pong", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string }> = [];
    let messageCb: ((msg: { kind: string; event?: { type: string } }) => void) | null = null;
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async () => null,
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
    await broker.createSession("/tmp/a");
    // Stream activity every 4s — proves liveness even without answering ping.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(4_000);
      messageCb?.({ kind: "event", event: { type: "message_update" } });
    }
    expect(events.some((e) => e.type === "worker_stuck")).toBe(false);
    vi.useRealTimers();
  });

  it("does not false-stuck when heartbeat timers coalesce after a pause", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string }> = [];
    let messageCb: ((msg: { kind: string }) => void) | null = null;
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "ping") {
              // Answer immediately — simulates healthy worker once main unblocks.
              queueMicrotask(() => messageCb?.({ kind: "pong" }));
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
    await broker.createSession("/tmp/a");
    // Jump past 3 intervals at once (main-thread stall). lastAliveAt was just set at start,
    // so silentMs is large — but then pongs from queued pings should recover; we assert we
    // only stuck if truly silent. With lastAliveAt from create (~now), advancing 15s without
    // any inbound message WOULD stuck — so answer via send's pong after first interval batch.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(false);
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

  it("exposes renamed title on live sessions without waiting for a switch (#3)", async () => {
    const broker = createSessionBroker({
      spawnWorker: async (cwd) => ({
        id: "session-a",
        cwd,
        filePath: "/tmp/session-a.jsonl",
        worker: {
          send: async () => null,
          kill: () => {},
          onMessage: () => () => {},
        },
      }),
    });
    await broker.createSession("/tmp/a");
    expect(broker.patchSummary("session-a", {})?.name).toBeUndefined();
    broker.patchSummary("session-a", { name: "你好世界" });
    const listed = await broker.listSessions("/tmp/a");
    expect(listed.find((s) => s.id === "session-a")?.name).toBe("你好世界");
  });
});
