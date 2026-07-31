import { describe, expect, it, vi } from "vitest";
import { createSessionBroker, type AllocateSession, type SpawnWorker } from "../../src/main/session-broker";

function allocateFixed(id: string): AllocateSession {
  return async (cwd) => ({ id, cwd, filePath: `/tmp/${id}.jsonl` });
}

function allocateSeq(ids: string[]): AllocateSession {
  let i = 0;
  return async (cwd) => {
    const id = ids[i] ?? `session-${i + 1}`;
    i += 1;
    return { id, cwd, filePath: `/tmp/${id}.jsonl` };
  };
}

function idFromPath(filePath?: string, fallback = "session-a"): string {
  if (!filePath) return fallback;
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? fallback;
  return base.replace(/\.jsonl$/i, "") || fallback;
}

function spawnEcho(): SpawnWorker {
  return async (cwd, filePath) => {
    const id = idFromPath(filePath);
    return {
      id,
      cwd,
      filePath: filePath ?? `/tmp/${id}.jsonl`,
      worker: {
        send: async () => null,
        kill: () => {},
        onMessage: () => () => {},
      },
    };
  };
}

describe("session-broker", () => {
  it("creates a disk session without spawning the agent worker", async () => {
    let spawnCount = 0;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => {
        spawnCount += 1;
        return {
          id: idFromPath(filePath),
          cwd,
          filePath: filePath ?? "/tmp/session-a.jsonl",
          worker: {
            send: async () => null,
            kill: () => {},
            onMessage: () => () => {},
          },
        };
      },
    });
    const created = await broker.createSession("/tmp/a");
    expect(created.id).toBe("session-a");
    expect(spawnCount).toBe(0);
    await broker.send(created.id, { type: "ping" });
    expect(spawnCount).toBe(1);
  });

  it("routes command to the matching session worker only", async () => {
    const hits: string[] = [];
    const broker = createSessionBroker({
      allocateSession: allocateSeq(["session-a", "session-b"]),
      spawnWorker: async (cwd, filePath) => {
        const id = idFromPath(filePath);
        return {
          id,
          cwd,
          filePath: filePath ?? `/tmp/${id}.jsonl`,
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
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => {
        spawnCount += 1;
        return {
          id: idFromPath(filePath),
          cwd,
          filePath: filePath ?? "/tmp/session-a.jsonl",
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
    expect(spawnCount).toBe(0);
    await broker.send(session.id, { type: "ping" });
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
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
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
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
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
    const session = await broker.createSession("/tmp/a");
    await broker.send(session.id, { type: "ping" });
    messageCb?.({ kind: "fatal", error: "worker exited (0)" });
    expect(events.some((e) => e.type === "prompt_error")).toBe(false);
    expect(events.some((e) => e.type === "session_status" && e.status === "error")).toBe(
      false,
    );
  });

  it("rejects pending commands when worker is terminated", async () => {
    const events: Array<{ type: string; status?: string }> = [];
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
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
    broker.onEvent((event) => events.push(event as { type: string; status?: string }));
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, { type: "hang" });
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "session_status" && e.status === "running")).toBe(
        true,
      );
    });
    await broker.killWorker(session.id);
    await expect(pending).rejects.toThrow("worker terminated");
  });

  it("disconnects worker before deleting session", async () => {
    let killed = false;
    let disconnectSend: string | null = null;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "shutdown") disconnectSend = "shutdown";
            return null;
          },
          kill: () => {
            killed = true;
          },
          onMessage: () => () => {},
        },
      }),
    });
    const session = await broker.createSession("/tmp/a");
    await broker.send(session.id, { type: "ping" });
    await broker.deleteSession(session.id, "/tmp/a");
    expect(disconnectSend).toBe("shutdown");
    expect(killed).toBe(true);
  });

  it("does not mark stuck during an active turn before the turn heartbeat window", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string }> = [];
    let killed = false;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          // Never answers ping / never emits — wedged mid-turn.
          send: async (msg) => {
            if (msg.kind === "command" && msg.command.type === "hang") {
              return new Promise(() => {});
            }
            return null;
          },
          kill: () => {
            killed = true;
          },
          onMessage: () => () => {},
        },
      }),
    });
    broker.onEvent((event) => events.push(event));
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, { type: "hang" });
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "session_status")).toBe(true);
    });
    // Idle window is 15s; turn window is 45s — stay alive just under turn limit.
    await vi.advanceTimersByTimeAsync(5_000 * 8);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(false);
    expect(killed).toBe(false);
    await broker.closeSession(session.id);
    await expect(pending).rejects.toThrow(/session closed|worker/);
    vi.useRealTimers();
  });

  it("marks stuck during an active turn after ~45s with no worker messages", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string }> = [];
    let killed = false;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "command" && msg.command.type === "hang") {
              return new Promise(() => {});
            }
            return null;
          },
          kill: () => {
            killed = true;
          },
          onMessage: () => () => {},
        },
      }),
    });
    broker.onEvent((event) => events.push(event));
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, { type: "hang" });
    const expectUnresponsive = expect(pending).rejects.toThrow(/worker unresponsive/);
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "session_status")).toBe(true);
    });
    await vi.advanceTimersByTimeAsync(5_000 * 9);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(true);
    expect(killed).toBe(true);
    await expectUnresponsive;
    vi.useRealTimers();
  });

  it("keeps an active turn alive when the worker answers ping", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string }> = [];
    let messageCb: ((msg: { kind: string }) => void) | null = null;
    let killed = false;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "ping") {
              queueMicrotask(() => messageCb?.({ kind: "pong" }));
            }
            if (msg.kind === "command" && msg.command.type === "hang") {
              return new Promise(() => {});
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
      }),
    });
    broker.onEvent((event) => events.push(event));
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, { type: "hang" });
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === "session_status")).toBe(true);
    });
    // Well past turn window — pongs keep lastAliveAt fresh.
    await vi.advanceTimersByTimeAsync(5_000 * 20);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(false);
    expect(killed).toBe(false);
    await broker.closeSession(session.id);
    await expect(pending).rejects.toThrow(/session closed|worker/);
    vi.useRealTimers();
  });

  it("emits session_status when heartbeat recovers from stuck to idle", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string; status?: string; sessionId?: string }> = [];
    let messageCb: ((msg: { kind: string }) => void) | null = null;
    let killed = false;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          send: async () => null,
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
      }),
    });
    broker.onEvent((event) => events.push(event as { type: string; status?: string; sessionId?: string }));
    const session = await broker.createSession("/tmp/a");
    await broker.send(session.id, { type: "ping" });
    await vi.advanceTimersByTimeAsync(5_000 * 3);
    expect(events.some((e) => e.type === "worker_stuck")).toBe(true);
    expect(killed).toBe(true);

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

  it("force-resolves abort when the worker never answers", async () => {
    vi.useFakeTimers();
    let killed = false;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          send: async () => null,
          kill: () => {
            killed = true;
          },
          onMessage: () => () => {},
        },
      }),
    });
    const session = await broker.createSession("/tmp/a");
    const pending = broker.send(session.id, { type: "abort" });
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(pending).resolves.toEqual({ ok: true, forced: true });
    expect(killed).toBe(true);
    vi.useRealTimers();
  });

  it("does not mark stuck when worker keeps sending events without pong", async () => {
    vi.useFakeTimers();
    const events: Array<{ type: string }> = [];
    let messageCb: ((msg: { kind: string; event?: { type: string } }) => void) | null = null;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
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
    await broker.send(session.id, { type: "ping" });
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
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => ({
        id: idFromPath(filePath),
        cwd,
        filePath: filePath ?? "/tmp/session-a.jsonl",
        worker: {
          send: async (msg) => {
            if (msg.kind === "ping") {
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
    const session = await broker.createSession("/tmp/a");
    await broker.send(session.id, { type: "ping" });
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
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => {
        spawnCount += 1;
        return {
          id: idFromPath(filePath),
          cwd,
          filePath: filePath ?? "/tmp/session-a.jsonl",
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
    const session = await broker.createSession("/tmp/a");
    expect(spawnCount).toBe(0);
    await broker.send(session.id, { type: "ping" });
    expect(spawnCount).toBe(1);
    await broker.notifyWorkersReloadModels();
    expect(killCount).toBe(1);
    expect(spawnCount).toBe(2);
  });

  it("trySend does not cold-start a worker", async () => {
    let spawnCount = 0;
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: async (cwd, filePath) => {
        spawnCount += 1;
        return {
          id: idFromPath(filePath),
          cwd,
          filePath: filePath ?? "/tmp/session-a.jsonl",
          worker: {
            send: async () => null,
            kill: () => {},
            onMessage: () => () => {},
          },
        };
      },
    });
    const session = await broker.createSession("/tmp/a");
    const result = await broker.trySend(session.id, { type: "get_state" });
    expect(result).toBeUndefined();
    expect(spawnCount).toBe(0);
  });

  it("exposes renamed title on live sessions without waiting for a switch (#3)", async () => {
    const broker = createSessionBroker({
      allocateSession: allocateFixed("session-a"),
      spawnWorker: spawnEcho(),
    });
    await broker.createSession("/tmp/a");
    expect(broker.patchSummary("session-a", {})?.name).toBeUndefined();
    broker.patchSummary("session-a", { name: "你好世界" });
    const listed = await broker.listSessions("/tmp/a");
    expect(listed.find((s) => s.id === "session-a")?.name).toBe("你好世界");
  });
});
