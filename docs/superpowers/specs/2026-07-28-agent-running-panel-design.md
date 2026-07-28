# Agent Running Panel (方案 A) — Design

**Date:** 2026-07-28  
**Status:** Approved (product)  
**Approach:** Process manager for Pi SDK bash — fixed first right-pane tab「运行」

## Goal

Give users a **visible, read-only** view of Pi SDK bash tool processes for the **current workspace (all sessions)**, with the ability to **manually terminate** them. This closes the gap where agent shell work is only partially visible in chat tool cards and cannot be managed.

## Product decisions (confirmed)

| Item | Choice |
|------|--------|
| Architecture | Scheme A — Agent process manager (not full PTY / not mirror-to-user-terminal) |
| Placement | Right pane **fixed first tab**, cannot close / cannot drag away |
| Tab label | 运行 / `Running` |
| Scope | **B** — all sessions under the **current workspace** |
| Finished items | **A** — list shows **running only**; entry disappears when the bash tool process ends |
| Output | Read-only streaming log |
| Actions | Terminate (kill process tree) only — no stdin, no re-run in v1 |

## Non-goals (v1)

- Interactive attach / typing into agent bash
- Mirroring into user Terminal tabs
- History archive of finished runs
- Scanning/killing orphan daemons that outlived the bash tool invocation (follow-up)
- Cross-workspace global process list

## UX

### Tab chrome

- Kind: `running` (or `runs`)
- Always at `tabs[0]` when a workspace is open
- Not closable; excluded from drag-reorder (or reorder snaps it back to index 0)
- Opening the tab shows the manager immediately

### Layout (inside tab)

```
┌─────────────┬──────────────────────────────┐
│ Run list    │ Read-only output             │
│ (running)   │ (selected run)               │
│             │                              │
│ [Terminate] │                              │
└─────────────┴──────────────────────────────┘
```

- **List row:** truncated command, session label/id, elapsed time, optional pid
- **Empty state:** no running agent commands
- **Terminate:** confirms lightly (or one-click with undo toast — prefer one-click kill for speed; optional confirm if destructive feel is needed — **default: one-click terminate**)
- When the selected run exits: remove from list; select next running item or clear output

### Relation to chat

- Chat bash tool cards remain as today
- Optional later: “在运行中查看” link from card → focus this tab + select run (not required for v1)

## Data model

```ts
type AgentRunId = string; // uuid per bash invocation

type AgentRun = {
  id: AgentRunId;
  sessionId: string;
  workspaceRoot: string; // normalized
  command: string;
  cwd: string;
  pid?: number;
  startedAt: number;
  status: "running" | "terminating";
  /** Ring/tail buffer for UI (e.g. last 256–512 KB text) */
  outputTail: string;
};
```

- Store keyed by workspace; renderer filters `workspaceRoot === current`
- Only `running` | `terminating` appear in UI; on exit, delete entry

## Architecture

```
AgentWorker (per session)
  └─ wrapped BashOperations.exec
       ├─ spawn + track pid / process tree
       ├─ stream stdout/stderr → postMessage run_output
       ├─ on start → run_started
       └─ on exit/abort → run_ended

SessionBroker / Main
  └─ AgentRunRegistry
       ├─ upsert from worker events
       ├─ terminate(runId) → signal worker to kill tree
       └─ push snapshots/events to renderer

Renderer
  └─ Right tab「运行」+ Pinia store
       ├─ list + select + bind output
       └─ terminate → IPC
```

### Integration with Pi SDK

- Prefer injecting custom `BashOperations` (or `spawnHook` + tracking around `createLocalBashOperations`) when creating session services in `agent-worker/runtime.ts`
- Reuse SDK helpers where possible (`killProcessTree` / detached pid tracking patterns from pi-coding-agent)
- Abort of the whole agent turn should also end tracked runs for that session (existing abort path + registry cleanup)

### Right-tabs rules

- On workspace load / `switchWorkspace`: ensure a `running` tab exists at index 0
- `closeTab`: no-op for `running`
- `reorderByIds` / Sortable: pin `running` at 0 after any reorder
- Persist: either always re-inject on restore, or persist kind but force index 0

## IPC (sketch)

- `runs:list` → AgentRun[] (sans huge buffers or with capped tail)
- `runs:subscribe` / push events: `started` | `output` | `ended` | `updated`
- `runs:terminate` (runId)
- Events scoped or filtered by workspace root in main before send

## Failure / edge cases

| Case | Behavior |
|------|----------|
| Worker crash | Mark/end all runs for that session; remove from list |
| Terminate while exiting | Idempotent; status `terminating` then remove on exit |
| Workspace switch | UI shows only new workspace runs; old workspace runs keep running in workers until ended/killed |
| Very noisy output | Cap tail buffer; UI virtualize or plain pre scroll |

## Success criteria

1. Right pane first tab is always「运行」and cannot be closed.
2. When any session in the workspace runs bash, it appears in the list with live read-only output.
3. Terminate stops that command’s process tree; row disappears when done.
4. Finished commands do not remain in the list.
5. User Terminal tabs remain independent.

## Open follow-ups

- Orphan daemon detection after tool returns
- Deep-link from ToolCallCard → Running tab
- Confirm dialog before terminate (if users prefer)
