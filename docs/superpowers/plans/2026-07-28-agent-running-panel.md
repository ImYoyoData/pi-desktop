# Agent Running Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed first right-pane tab「运行 / Running」that lists live Pi SDK bash processes for the current workspace (all sessions), streams read-only output, and supports one-click Terminate.

**Architecture:** Wrap `createLocalBashOperations` in the agent-worker and override the builtin `bash` tool via `customTools: [createBashToolDefinition(...)]`. Worker posts `run_*` messages; main `AgentRunRegistry` aggregates by workspace and pushes IPC events; renderer Pinia store + `RunningTab.vue` render list + log. Terminate aborts the run’s linked `AbortController` (SDK kills the process tree).

**Tech Stack:** Electron utilityProcess worker, `@earendil-works/pi-coding-agent` (`createLocalBashOperations`, `createBashToolDefinition`), Vue 3 + Pinia, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-agent-running-panel-design.md`
- Scheme A only — process manager, not PTY / not mirror to user Terminal
- Scope B — all sessions under **current workspace**
- List A — **running only**; remove on exit (no history)
- Output read-only; Terminate only (one-click, no confirm in v1)
- User Terminal tabs remain independent
- Do not commit unless the user explicitly asks (user rule overrides “frequent commits” — mark commit steps optional)
- Reply / UI copy: zh-CN + en i18n keys

## File map

| Area | Primary files |
|------|----------------|
| Shared types / IPC | `src/shared/agent-runs.ts` (new), `src/shared/agent-worker-messages.ts`, `src/shared/protocol.ts` |
| Worker bash wrap | `src/agent-worker/bash-run-tracker.ts` (new), `src/agent-worker/runtime.ts` |
| Main registry / IPC | `src/main/agent-run-registry.ts` (new), `src/main/agent-runs-ipc.ts` (new), `src/main/session-broker.ts`, `src/main/index.ts` |
| Preload | `src/preload/index.ts` |
| Right tabs | `src/renderer/src/stores/right-tabs.ts`, `src/renderer/src/components/RightPane.vue` |
| UI | `src/renderer/src/stores/agent-runs.ts` (new), `src/renderer/src/components/RunningTab.vue` (new) |
| i18n | `src/renderer/src/i18n/zh-CN.ts`, `src/renderer/src/i18n/en.ts` |
| Tests | `tests/agent-worker/bash-run-tracker.test.ts`, `tests/main/agent-run-registry.test.ts`, `tests/renderer/right-tabs-running.test.ts` (or extend existing patterns) |

---

### Task 1: Shared AgentRun types + worker message kinds

**Files:**
- Create: `src/shared/agent-runs.ts`
- Modify: `src/shared/agent-worker-messages.ts`
- Modify: `src/shared/protocol.ts` (add `IpcChannels.runs.*`)
- Test: `tests/shared/protocol.test.ts` (extend if it asserts channel shape; otherwise skip)

**Interfaces:**
- Produces: `AgentRunId`, `AgentRunSnapshot`, `AgentRunEvent`, worker `run_*` / `terminate_run`, IPC channel strings

- [ ] **Step 1: Add shared run types**

Create `src/shared/agent-runs.ts`:

```ts
export type AgentRunId = string;

export type AgentRunStatus = "running" | "terminating";

/** Snapshot pushed to renderer (tail already capped). */
export type AgentRunSnapshot = {
  id: AgentRunId;
  sessionId: string;
  workspaceRoot: string;
  command: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  status: AgentRunStatus;
  outputTail: string;
};

export type AgentRunEvent =
  | { type: "upsert"; run: AgentRunSnapshot }
  | { type: "output"; runId: AgentRunId; chunk: string; outputTail: string }
  | { type: "ended"; runId: AgentRunId }
  | { type: "snapshot"; runs: AgentRunSnapshot[] };
```

- [ ] **Step 2: Extend worker messages**

In `src/shared/agent-worker-messages.ts`, extend:

```ts
export type WorkerInbound =
  | { kind: "init"; cwd: string; filePath?: string }
  | { kind: "command"; id: string; command: AgentCommand }
  | { kind: "reload_models" }
  | { kind: "shutdown" }
  | { kind: "ping" }
  | { kind: "terminate_run"; runId: string };

export type WorkerOutbound =
  | { kind: "ready"; id: string; filePath: string; cwd: string }
  | { kind: "result"; id: string; data?: unknown; error?: string }
  | { kind: "event"; event: Record<string, unknown> }
  | { kind: "pong" }
  | { kind: "fatal"; error: string }
  | {
      kind: "run_started";
      run: {
        id: string;
        sessionId: string;
        workspaceRoot: string;
        command: string;
        cwd: string;
        pid?: number;
        startedAt: number;
      };
    }
  | { kind: "run_output"; runId: string; chunk: string }
  | { kind: "run_ended"; runId: string };
```

- [ ] **Step 3: Add IPC channels**

In `src/shared/protocol.ts` inside `IpcChannels`:

```ts
  runs: {
    list: "runs:list",
    terminate: "runs:terminate",
    event: "runs:event",
  },
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.node.json` (or project’s usual typecheck script)  
Expected: PASS (or only pre-existing errors unrelated to these files)

- [ ] **Step 5: Commit (optional)**

```bash
git add src/shared/agent-runs.ts src/shared/agent-worker-messages.ts src/shared/protocol.ts
git commit -m "feat: add agent run shared types and IPC channels"
```

---

### Task 2: Worker bash run tracker + inject custom bash tool

**Files:**
- Create: `src/agent-worker/bash-run-tracker.ts`
- Modify: `src/agent-worker/runtime.ts`
- Test: `tests/agent-worker/bash-run-tracker.test.ts`

**Interfaces:**
- Consumes: `createLocalBashOperations`, `createBashToolDefinition` from `@earendil-works/pi-coding-agent`; `WorkerOutbound` run kinds
- Produces: `createTrackedBashOperations`, `terminateRun(runId)`, `endAllRuns()`; session init wires `customTools`

**Integration note (critical):**  
`createAgentSessionFromServices` does **not** expose `baseToolsOverride`. Custom tools with the same name **replace** builtins in `AgentSession._refreshToolRegistry`. Pass:

```ts
customTools: [
  createBashToolDefinition(cwd, {
    operations: createTrackedBashOperations(createLocalBashOperations(), hooks),
  }),
]
```

Terminate = abort a per-run `AbortController` linked to the SDK `signal`; local ops already call `killProcessTree` on abort. `pid` is optional in v1 (leave undefined unless easily available).

- [ ] **Step 1: Write failing unit tests for tracker**

Create `tests/agent-worker/bash-run-tracker.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npx vitest run tests/agent-worker/bash-run-tracker.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement tracker**

Create `src/agent-worker/bash-run-tracker.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { BashOperations } from "@earendil-works/pi-coding-agent";

export type TrackedRunStart = {
  id: string;
  sessionId: string;
  workspaceRoot: string;
  command: string;
  cwd: string;
  startedAt: number;
  pid?: number;
};

export type BashRunTrackerHooks = {
  sessionId: string;
  workspaceRoot: string;
  onStarted: (run: TrackedRunStart) => void;
  onOutput: (runId: string, chunk: string) => void;
  onEnded: (runId: string) => void;
};

const MAX_TAIL_CHARS = 512 * 1024;

export function createTrackedBashOperations(
  base: BashOperations,
  hooks: BashRunTrackerHooks,
): {
  operations: BashOperations;
  terminateRun: (runId: string) => boolean;
  endAllRuns: () => void;
  getActiveRunIds: () => string[];
} {
  const controllers = new Map<string, AbortController>();

  function terminateRun(runId: string): boolean {
    const c = controllers.get(runId);
    if (!c) return false;
    c.abort();
    return true;
  }

  function endAllRuns(): void {
    for (const c of controllers.values()) c.abort();
  }

  function getActiveRunIds(): string[] {
    return [...controllers.keys()];
  }

  const operations: BashOperations = {
    exec: async (command, cwd, options) => {
      const id = randomUUID();
      const local = new AbortController();
      controllers.set(id, local);

      const onOuterAbort = () => local.abort();
      if (options.signal) {
        if (options.signal.aborted) local.abort();
        else options.signal.addEventListener("abort", onOuterAbort, { once: true });
      }

      const startedAt = Date.now();
      hooks.onStarted({
        id,
        sessionId: hooks.sessionId,
        workspaceRoot: hooks.workspaceRoot,
        command,
        cwd,
        startedAt,
      });

      try {
        return await base.exec(command, cwd, {
          ...options,
          signal: local.signal,
          onData: (data) => {
            const chunk = data.toString("utf8");
            hooks.onOutput(id, chunk);
            options.onData(data);
          },
        });
      } finally {
        options.signal?.removeEventListener("abort", onOuterAbort);
        controllers.delete(id);
        hooks.onEnded(id);
      }
    },
  };

  return { operations, terminateRun, endAllRuns, getActiveRunIds };
}

/** Cap ring buffer used by main registry; worker may send raw chunks. */
export function appendCappedTail(prev: string, chunk: string, max = MAX_TAIL_CHARS): string {
  const next = prev + chunk;
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/agent-worker/bash-run-tracker.test.ts`  
Expected: PASS

- [ ] **Step 5: Wire into `runtime.ts`**

In `initSession`:

1. Import `createBashToolDefinition`, `createLocalBashOperations` from `@earendil-works/pi-coding-agent`.
2. Import tracker helpers.
3. Keep module-level `let runTracker: ReturnType<typeof createTrackedBashOperations> | null = null`.
4. Before `createAgentSessionFromServices`, build tracker with `sessionId: sessionManager.getSessionId()`, `workspaceRoot: cwd`, and hooks that `post({ kind: "run_started" | "run_output" | "run_ended", ... })`.
5. Pass `customTools: [createBashToolDefinition(cwd, { operations: runTracker.operations })]`.
6. In `handleWorkerMessage`, handle `{ kind: "terminate_run"; runId }` → `runTracker?.terminateRun(runId)`.
7. On `shutdown`, call `runTracker?.endAllRuns()` before exit.

Sketch for hooks posting:

```ts
runTracker = createTrackedBashOperations(createLocalBashOperations(), {
  sessionId: sessionManager.getSessionId(),
  workspaceRoot: cwd,
  onStarted: (run) => post({ kind: "run_started", run }),
  onOutput: (runId, chunk) => post({ kind: "run_output", runId, chunk }),
  onEnded: (runId) => post({ kind: "run_ended", runId }),
});
```

- [ ] **Step 6: Commit (optional)**

```bash
git add src/agent-worker/bash-run-tracker.ts src/agent-worker/runtime.ts tests/agent-worker/bash-run-tracker.test.ts
git commit -m "feat: track agent bash runs in worker"
```

---

### Task 3: Main AgentRunRegistry + broker routing + IPC

**Files:**
- Create: `src/main/agent-run-registry.ts`
- Create: `src/main/agent-runs-ipc.ts`
- Modify: `src/main/session-broker.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Test: `tests/main/agent-run-registry.test.ts`

**Interfaces:**
- Consumes: worker `run_*` messages; `WorkerHandle.send({ kind: "terminate_run" })`
- Produces: `createAgentRunRegistry()`, `registerAgentRunsIpc()`, preload `api.runs.{list,terminate,onEvent}`

- [ ] **Step 1: Failing registry tests**

Create `tests/main/agent-run-registry.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run tests/main/agent-run-registry.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement registry**

Create `src/main/agent-run-registry.ts`:

- Normalize workspace roots like right-tabs (`replace \\` → `/`, trim trailing `/`, lower-case).
- Cap `outputTail` with `appendCappedTail` (import from tracker file **or** duplicate a tiny helper in `src/shared/agent-runs.ts` to avoid main importing agent-worker — **prefer moving `appendCappedTail` to `src/shared/agent-runs.ts`** and use it from both).
- `handleWorkerMessage(sessionId, msg)` only acts on `run_*` kinds; ignore others.
- `list(workspaceRoot)` returns running/terminating snapshots for that workspace.
- `terminate(runId)` → status `terminating` + `sendTerminate(sessionId, runId)`.
- `endSessionRuns(sessionId)` → emit `ended` for each and delete (worker crash / killWorker / closeSession).

If `appendCappedTail` was only in tracker, **move** it to `src/shared/agent-runs.ts` in this task and update tracker import.

- [ ] **Step 4: Route in session-broker**

Options (pick one; prefer A for isolation):

**A (preferred):** Construct registry outside broker; broker accepts optional callbacks:

```ts
export function createSessionBroker(deps: {
  spawnWorker: SpawnWorker;
  idleDestroyMs?: number;
  onWorkerMessage?: (sessionId: string, msg: WorkerOutbound) => void;
  onSessionWorkerGone?: (sessionId: string) => void;
}): SessionBroker
```

In `attachWorker` message handler, after existing handling (or for `run_*` early):

```ts
deps.onWorkerMessage?.(sessionId, msg);
```

On `killWorker` / fatal exit / `closeSession` / clean worker exit paths that null out worker:

```ts
deps.onSessionWorkerGone?.(sessionId);
```

Expose on broker (or keep registry in index):

```ts
// index.ts
const registry = createAgentRunRegistry({
  onEvent: (e) => broadcastRunsEvent(e),
  sendTerminate: async (sessionId, runId) => {
    const rec = /* need access */;
  },
});
```

**Cleaner:** add thin methods on broker:

```ts
// SessionBroker additions
getWorkerSend: (sessionId: string) => ((msg: WorkerInbound) => Promise<...>) | null;
```

Or registry `sendTerminate` closes over broker:

```ts
const broker = createSessionBroker({
  spawnWorker: ...,
  onWorkerMessage: (sessionId, msg) => registry.handleWorkerMessage(sessionId, msg),
  onSessionWorkerGone: (sessionId) => registry.endSessionRuns(sessionId),
});

// After broker exists — fix circular init:
const registryHolder: { current: ReturnType<typeof createAgentRunRegistry> | null } = {
  current: null,
};
const broker = createSessionBroker({
  spawnWorker: createUtilityProcessSpawnWorker(),
  onWorkerMessage: (sid, msg) => registryHolder.current?.handleWorkerMessage(sid, msg),
  onSessionWorkerGone: (sid) => registryHolder.current?.endSessionRuns(sid),
});
registryHolder.current = createAgentRunRegistry({
  onEvent: broadcastRunsEvent,
  sendTerminate: async (sessionId, runId) => {
    await broker.sendRaw?.(sessionId, { kind: "terminate_run", runId });
  },
});
```

Simplest concrete API — add to `SessionBroker`:

```ts
sendRaw: (sessionId: string, msg: WorkerInbound) => Promise<WorkerOutbound | null>;
```

Implementation: `ensureWorker` then `worker.send(msg)` without pending-command tracking (like ping).

- [ ] **Step 5: IPC + preload**

`src/main/agent-runs-ipc.ts`:

```ts
export function registerAgentRunsIpc(registry: {
  list: (workspaceRoot: string) => AgentRunSnapshot[];
  terminate: (runId: string) => Promise<void>;
}): void {
  ipcMain.handle(IpcChannels.runs.list, (_e, workspaceRoot: string) =>
    registry.list(workspaceRoot ?? ""),
  );
  ipcMain.handle(IpcChannels.runs.terminate, (_e, runId: string) =>
    registry.terminate(runId),
  );
}

export function broadcastRunsEvent(event: AgentRunEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.runs.event, event);
  }
}
```

Register in `src/main/index.ts` next to sessions IPC.

Preload `api.runs`:

```ts
runs: {
  list: (workspaceRoot: string) =>
    ipcRenderer.invoke(IpcChannels.runs.list, workspaceRoot) as Promise<AgentRunSnapshot[]>,
  terminate: (runId: string) =>
    ipcRenderer.invoke(IpcChannels.runs.terminate, runId) as Promise<void>,
  onEvent: (callback: (event: AgentRunEvent) => void) => {
    const listener = (_: unknown, event: AgentRunEvent) => callback(event);
    ipcRenderer.on(IpcChannels.runs.event, listener);
    return () => ipcRenderer.removeListener(IpcChannels.runs.event, listener);
  },
},
```

Update renderer `Window` / api typings wherever `api` is declared (search `sessions: {` in preload typings / `src/renderer/src/env.d.ts` / `src/preload` types).

- [ ] **Step 6: Tests PASS + typecheck**

Run: `npx vitest run tests/main/agent-run-registry.test.ts tests/main/session-broker.test.ts`  
Expected: PASS (update broker tests if `onWorkerMessage` required — make optional)

- [ ] **Step 7: Commit (optional)**

```bash
git add src/main/agent-run-registry.ts src/main/agent-runs-ipc.ts src/main/session-broker.ts src/main/index.ts src/preload/index.ts src/shared/agent-runs.ts tests/main/agent-run-registry.test.ts
git commit -m "feat: aggregate agent runs in main and expose IPC"
```

---

### Task 4: Pin「运行」as fixed first right tab

**Files:**
- Modify: `src/renderer/src/stores/right-tabs.ts`
- Modify: `src/renderer/src/components/RightPane.vue`
- Modify: `src/renderer/src/i18n/zh-CN.ts`, `src/renderer/src/i18n/en.ts`
- Test: `tests/renderer/right-tabs-running.test.ts` (extract pin helpers if needed for pure unit test)

**Interfaces:**
- Consumes: new kind `"running"`
- Produces: `ensureRunningTab()`, close no-op, reorder snaps index 0

- [ ] **Step 1: i18n keys**

```ts
// zh-CN
runningTab: "运行",
runningEmpty: "当前工作区没有正在运行的 Agent 命令",
runningTerminate: "终止",
runningElapsed: (s: number) => `${s}s`,
runningSession: "会话",

// en
runningTab: "Running",
runningEmpty: "No running agent commands in this workspace",
runningTerminate: "Terminate",
runningElapsed: (s: number) => `${s}s`,
runningSession: "Session",
```

- [ ] **Step 2: Extend `RightTabKind` + helpers**

```ts
export type RightTabKind =
  | "running"
  | "changes"
  | "files"
  | "browser"
  | "terminal"
  | "preview";
```

Add:

```ts
function ensureRunningTabPinned(): void {
  const existing = tabs.value.find((t) => t.kind === "running");
  if (!existing) {
    const tab: RightTab = {
      id: nextTabId("running"),
      kind: "running",
      label: t.runningTab,
    };
    tabs.value = [tab, ...tabs.value.filter((t) => t.kind !== "running")];
    return;
  }
  const others = tabs.value.filter((t) => t.id !== existing.id);
  tabs.value = [existing, ...others];
}
```

Call `ensureRunningTabPinned()` at end of `restoreTabs`, `switchWorkspace` (both park restore + restoreTabs paths), and initial store state:

```ts
const tabs = ref<RightTab[]>([
  { id: "running-0", kind: "running", label: t.runningTab },
  { id: "changes-0", kind: "changes", label: t.changesTab },
]);
```

`closeTab`: if `tab.kind === "running"` return immediately.

`reorderByIds`: after applying order, call `ensureRunningTabPinned()`.

`addTab("running")`: reuse existing like changes/files; never create second.

`persistTabs`: **do** persist `running` kind (or always re-inject — either works if `ensureRunningTabPinned` runs on restore). Prefer persist + ensure.

Default empty workspace restore (no root): still include running+changes.

Update exhaustive `switch` in `addTab` for label.

- [ ] **Step 3: RightPane UI chrome**

- Import `PlayCircleOutline` (or `PulseOutline`) for running icon.
- `iconFor`: case `"running"`.
- Hide close button when `tab.kind === "running"` (same pattern as any non-closable).
- Sortable: set `filter: ".tab-close, .tab-pinned"` and add class `tab-pinned` on running tab **or** `draggable: ".tab-item:not(.tab-pinned)"`.
- After reorder callback already calls `reorderByIds` which pins — also re-bind DOM order if needed via `nextTick`.
- Content area: when active kind is `running`, render `<RunningTab />` (stub empty component ok until Task 5).

- [ ] **Step 4: Unit test pin behavior**

If store is hard to unit-test without Pinia DOM, extract pure functions:

```ts
// src/renderer/src/utils/right-tabs-running.ts
export function pinRunningFirst<T extends { kind: string }>(tabs: T[]): T[] {
  const running = tabs.filter((t) => t.kind === "running");
  const rest = tabs.filter((t) => t.kind !== "running");
  if (running.length === 0) return tabs;
  return [running[0]!, ...rest, ...running.slice(1)];
}
```

Test that helper; store calls it inside `ensureRunningTabPinned` / `reorderByIds`.

- [ ] **Step 5: Manual check**

Run: `npm run dev`  
Expected: first tab「运行」; cannot close; drag other tabs still leaves 运行 at index 0.

- [ ] **Step 6: Commit (optional)**

```bash
git add src/renderer/src/stores/right-tabs.ts src/renderer/src/components/RightPane.vue src/renderer/src/i18n/*.ts src/renderer/src/utils/right-tabs-running.ts tests/renderer/right-tabs-running.test.ts
git commit -m "feat: pin Running as fixed first right tab"
```

---

### Task 5: RunningTab UI + Pinia agent-runs store

**Files:**
- Create: `src/renderer/src/stores/agent-runs.ts`
- Create: `src/renderer/src/components/RunningTab.vue`
- Modify: `src/renderer/src/components/RightPane.vue` (mount store subscribe)
- Modify: `src/renderer/src/App.vue` or workspace watcher — subscribe when workspace ready

**Interfaces:**
- Consumes: `api.runs.list/onEvent/terminate`, `workspace.root`
- Produces: filtered list UI + selected output + terminate

- [ ] **Step 1: Pinia store**

```ts
// src/renderer/src/stores/agent-runs.ts
export const useAgentRunsStore = defineStore("agentRuns", () => {
  const runs = ref<AgentRunSnapshot[]>([]);
  const selectedId = ref<string | null>(null);
  let unsub: (() => void) | null = null;

  const selected = computed(() =>
    runs.value.find((r) => r.id === selectedId.value) ?? null,
  );

  function applyEvent(event: AgentRunEvent): void {
    switch (event.type) {
      case "snapshot":
        runs.value = event.runs;
        break;
      case "upsert": {
        const i = runs.value.findIndex((r) => r.id === event.run.id);
        if (i >= 0) runs.value[i] = event.run;
        else runs.value = [...runs.value, event.run];
        if (!selectedId.value) selectedId.value = event.run.id;
        break;
      }
      case "output": {
        const i = runs.value.findIndex((r) => r.id === event.runId);
        if (i < 0) return;
        const prev = runs.value[i]!;
        runs.value[i] = { ...prev, outputTail: event.outputTail };
        break;
      }
      case "ended": {
        runs.value = runs.value.filter((r) => r.id !== event.runId);
        if (selectedId.value === event.runId) {
          selectedId.value = runs.value[0]?.id ?? null;
        }
        break;
      }
      default: {
        const _never: never = event;
        void _never;
      }
    }
  }

  async function refresh(workspaceRoot: string | null): Promise<void> {
    if (!workspaceRoot) {
      runs.value = [];
      selectedId.value = null;
      return;
    }
    runs.value = await window.api.runs.list(workspaceRoot);
    if (selectedId.value && !runs.value.some((r) => r.id === selectedId.value)) {
      selectedId.value = runs.value[0]?.id ?? null;
    }
  }

  function bind(): void {
    unsub?.();
    unsub = window.api.runs.onEvent(applyEvent);
  }

  function unbind(): void {
    unsub?.();
    unsub = null;
  }

  async function terminate(runId: string): Promise<void> {
    await window.api.runs.terminate(runId);
  }

  function select(id: string): void {
    selectedId.value = id;
  }

  return {
    runs,
    selectedId,
    selected,
    applyEvent,
    refresh,
    bind,
    unbind,
    terminate,
    select,
  };
});
```

On workspace root change: `refresh(root)`. On app mount: `bind()`.

Filter: main already scopes list by workspace; events for other workspaces may still arrive — in `applyEvent` for upsert/output, ignore if `run.workspaceRoot` normalized ≠ current workspace (pass workspace store into filter, or have main only broadcast events for all and filter in store).

**Preferred:** main broadcasts all run events; renderer store filters by `normalizeRoot(workspace.root)`.

- [ ] **Step 2: `RunningTab.vue` layout**

Split list | output:

```vue
<template>
  <div class="running-tab">
    <aside class="run-list">
      <NEmpty v-if="!store.runs.length" :description="t.runningEmpty" />
      <button
        v-for="run in store.runs"
        :key="run.id"
        type="button"
        class="run-row"
        :class="{ active: run.id === store.selectedId }"
        @click="store.select(run.id)"
      >
        <div class="cmd">{{ truncate(run.command) }}</div>
        <div class="meta">
          {{ sessionLabel(run.sessionId) }} · {{ elapsed(run.startedAt) }}
        </div>
        <NButton size="tiny" @click.stop="onTerminate(run.id)">
          {{ t.runningTerminate }}
        </NButton>
      </button>
    </aside>
    <pre class="run-out">{{ store.selected?.outputTail ?? "" }}</pre>
  </div>
</template>
```

- Auto-scroll output `pre` when selected run receives output (watch `outputTail` length).
- Elapsed: `setInterval` 1s tick refreshing a `now` ref.
- Session label: short id slice or lookup session name from sessions store if available; else `sessionId.slice(0, 8)`.
- Styles: match existing RightPane tab panels (flex, overflow, monospace for output). Keep minimal — no card clutter.

- [ ] **Step 3: Wire lifecycle**

In `RunningTab.vue` `onMounted`: `store.bind()` if not already global; or bind once in `App.vue` / `ChatPanel` parent. Prefer **single bind in App or RightPane** so events arrive even when tab not active (list stays warm).

Watch `workspace.root` → `store.refresh(root)`.

- [ ] **Step 4: Manual E2E**

1. Open workspace, confirm「运行」empty state.
2. Prompt agent to `sleep 30` or long `ping` — row appears; output streams.
3. Click Terminate — row enters terminating then disappears.
4. Let command finish naturally — row disappears; no history.
5. Two sessions in same workspace both running — both listed.
6. Switch workspace — list shows only that workspace’s runs.
7. User Terminal tab still independent.

- [ ] **Step 5: Commit (optional)**

```bash
git add src/renderer/src/stores/agent-runs.ts src/renderer/src/components/RunningTab.vue src/renderer/src/components/RightPane.vue src/renderer/src/App.vue
git commit -m "feat: Running tab UI for live agent bash processes"
```

---

### Task 6: Integration polish + verification

**Files:**
- Touch-ups from review: components.d.ts auto-gen, exhaustive switches, typecheck
- Tests regression suite

- [ ] **Step 1: Full unit tests**

Run: `npx vitest run`  
Expected: all PASS (including new ones)

- [ ] **Step 2: Typecheck**

Run: project script e.g. `npm run typecheck`  
Expected: PASS

- [ ] **Step 3: Edge-case checklist (manual)**

| Case | Expected |
|------|----------|
| Worker kill / crash mid-run | Runs for that session removed |
| Terminate twice | Idempotent |
| Abort turn (composer stop) | SDK abort → run_ended → row gone |
| Noisy output | Tail capped; UI still responsive |
| Workspace switch | UI filters; old workers keep running until end |

- [ ] **Step 4: Self-check vs spec success criteria**

1. First tab always「运行」, not closable — Task 4  
2. Bash from any session in workspace appears with live output — Tasks 2–5  
3. Terminate kills tree; row gone when done — Tasks 2–3–5  
4. Finished commands not listed — Task 3 registry delete on end  
5. User Terminal independent — no code path ties them  

- [ ] **Step 5: Commit (optional)**

Only if user asked.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Scheme A process manager | 2–5 |
| Fixed first tab 运行/Running | 4 |
| Scope = current workspace all sessions | 3 list filter + 5 store filter |
| Running-only list | 3 `run_ended` deletes |
| Read-only output + Terminate | 5 |
| Worker wrap bash | 2 |
| Registry + IPC | 3 |
| Worker crash cleanup | 3 `endSessionRuns` |
| Output tail cap | shared `appendCappedTail` |
| Non-goals (PTY, history, orphan scan) | not in plan |

**Type consistency:** `AgentRunSnapshot` / `AgentRunEvent` defined in Task 1; registry + store use the same names. Worker posts `run_started.run` fields matching snapshot minus `status`/`outputTail` (registry fills those).

**Placeholders:** none intentional — commit steps marked optional per user rule.
