import { describe, expect, it, vi } from "vitest";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import { createTrackedBashOperations, __test } from "../../src/agent-worker/bash-run-tracker";

function mockBase(opts?: {
  hangUntilAbort?: boolean;
}): BashOperations {
  return {
    exec: async (_command, _cwd, { onData, signal }) => {
      onData(Buffer.from("hello\n"));
      if (opts?.hangUntilAbort) {
        await new Promise<void>((_resolve, reject) => {
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
        await new Promise<void>((_resolve, reject) => {
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

describe("后台截断提示的来源与语言", () => {
  it("软件自动判定常驻进程时提示「自动截断」", async () => {
    const base: BashOperations = {
      exec: async (_command, _cwd, { onData }) => {
        onData(Buffer.from("x\n"));
        return { exitCode: 0 };
      },
    };
    const chunks: string[] = [];
    const { operations } = createTrackedBashOperations(base, {
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => {},
      onOutput: (_id, chunk) => chunks.push(chunk),
      onEnded: () => {},
      shouldStartBackground: () => true,
    });
    await operations.exec("npm run dev", "/ws", { onData: () => {} });
    expect(chunks.join("")).toContain("自动截断");
  });

  it("用户点击「转到后台」时提示「用户截断」", async () => {
    const base: BashOperations = {
      exec: async (_command, _cwd, { onData, signal }) => {
        onData(Buffer.from("x\n"));
        await new Promise<void>((_resolve, reject) => {
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
    const chunks: string[] = [];
    const { operations, backgroundRun, getActiveRunIds } = createTrackedBashOperations(base, {
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => {},
      onOutput: (_id, chunk) => chunks.push(chunk),
      onEnded: () => {},
    });
    const p = operations.exec("sleep 30", "/ws", { onData: () => {} });
    await vi.waitFor(() => expect(getActiveRunIds().length).toBe(1));
    expect(backgroundRun(getActiveRunIds()[0]!)).toBe(true);
    await expect(p).resolves.toEqual({ exitCode: null });
    expect(chunks.join("")).toContain("用户截断");
  });

  it("跟随界面语言切换文案", async () => {
    const base: BashOperations = {
      exec: async (_command, _cwd, { onData }) => {
        onData(Buffer.from("x\n"));
        return { exitCode: 0 };
      },
    };
    const chunks: string[] = [];
    const { operations } = createTrackedBashOperations(base, {
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => {},
      onOutput: (_id, chunk) => chunks.push(chunk),
      onEnded: () => {},
      shouldStartBackground: () => true,
      getLocale: () => "en",
    });
    await operations.exec("npm run dev", "/ws", { onData: () => {} });
    expect(chunks.join("")).toContain("Auto-truncated");
  });
});

describe("bash timeout / shell resolution", () => {
  it("treats a missing timeout as no timeout", () => {
    expect(__test.resolveTimeoutMs(undefined)).toBeUndefined();
  });

  it("converts seconds to milliseconds", () => {
    expect(__test.resolveTimeoutMs(30)).toBe(30_000);
  });

  it("rejects non-positive and non-finite values", () => {
    expect(() => __test.resolveTimeoutMs(0)).toThrow(/finite number of seconds/);
    expect(() => __test.resolveTimeoutMs(-5)).toThrow(/finite number of seconds/);
    expect(() => __test.resolveTimeoutMs(Number.NaN)).toThrow(/finite number of seconds/);
  });

  it("rejects timeouts beyond the setTimeout ceiling", () => {
    expect(() => __test.resolveTimeoutMs(2_147_484)).toThrow(/maximum is/);
  });

  it.runIf(process.platform === "win32")("resolves the powershell config for a powershell shell", () => {
    const config = __test.resolveShellConfig({
      shellKind: "powershell",
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => {},
      onOutput: () => {},
      onEnded: () => {},
    });
    expect(config.shell.toLowerCase()).toMatch(/pwsh|powershell/);
  });

  it("falls back to the SDK default when no shell was detected", () => {
    const config = __test.resolveShellConfig({
      shellKind: "unresolved",
      sessionId: "s1",
      workspaceRoot: "/ws",
      onStarted: () => {},
      onOutput: () => {},
      onEnded: () => {},
    });
    expect(config.shell.length).toBeGreaterThan(0);
  });
});
