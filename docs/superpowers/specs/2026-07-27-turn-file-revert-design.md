# Turn file revert (checkpoint) — Design

**Date:** 2026-07-27  
**Status:** Approved — implementing  
**Product:** Pi Desktop

## Goal

After each agent turn finishes, show a **撤回** control (Cursor-like) that restores **workspace files only** to the state right before that user prompt. Chat history is unchanged.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | Files only (create / modify / delete) |
| Chat | Keep messages; no truncate |
| Mechanism | Per-turn file content snapshot (Approach A) |
| Git | Optional helper only; do not require a repo or create commits |
| Placement | On the completed turn’s user bubble / turn actions row |

## Behavior

1. **Capture** — When the user sends a `prompt` (including queue auto-drain as prompt), Main starts a checkpoint for `(sessionId, userMessageId)` and records baselines for files that change during the turn.
2. **Track** — While the session is `running` for that turn, workspace `fs` events (`add` / `change` / `unlink`) under the workspace root update the checkpoint:
   - First time a path is seen: store prior content (or `missing` if it did not exist).
   - Ignore `node_modules`, `.git`, build dirs (same deny-list as fs-watch).
   - Skip binary / files larger than **2 MiB** (record as `skipped`).
3. **Offer UI** — On `prompt_done` / idle for that turn, if the checkpoint has at least one restorable path, show **撤回** next to that user message.
4. **Revert** — On click, confirm, then restore:
   - Had content → write back previous bytes/text  
   - Was missing → delete the file  
   - Was deleted → recreate with previous content  
   Mark checkpoint `reverted`; button becomes disabled / 「已撤回」.
5. **Non-goals** — No chat rewind; no automatic `git commit`/`stash`; no multi-turn cascading undo beyond restoring that turn’s captured paths.

## Data model (Main)

```ts
type CheckpointFileEntry =
  | { path: string; kind: "text"; previous: string }      // existed before first touch
  | { path: string; kind: "missing" }                     // created during turn
  | { path: string; kind: "skipped"; reason: string };

type TurnCheckpoint = {
  id: string;
  sessionId: string;
  userMessageId: string;
  workspaceRoot: string;
  status: "capturing" | "ready" | "reverted" | "empty";
  files: Map<string, CheckpointFileEntry>; // relative posix paths
  createdAt: number;
};
```

Persistence: **in-memory for v1** (lost on app restart). Optional disk cache later.

## IPC

- `checkpoint.begin({ sessionId, userMessageId })`
- `checkpoint.finish({ sessionId, userMessageId })` → `{ ready, fileCount, skippedCount }`
- `checkpoint.get(sessionId, userMessageId)` → summary for UI
- `checkpoint.revert(sessionId, userMessageId)` → `{ ok, restored, skipped, error? }`
- Optional push: `checkpoint.updated` when status flips to `ready`

## Renderer

- On `sendPrompt` / queue dispatch prompt: after optimistic user message id is known, call `checkpoint.begin`.
- On turn idle (`prompt_done` / running false for that session): `checkpoint.finish`.
- `MessageList`: for each user message with a ready checkpoint, show **撤回**; confirm dialog; toast result.
- i18n: `revertTurn`, `revertTurnConfirm`, `revertTurnDone`, `revertTurnEmpty`, `reverted`.

## Edge cases

| Case | Behavior |
|------|----------|
| User edits same file after turn, then reverts | Overwrite with pre-turn content (Cursor-like) |
| Overlapping turns (queue) | One active capture per session; next begin finishes previous if still capturing |
| Workspace switch mid-turn | Abort capture; no button |
| Binary / huge file | Skip + count in toast |
| App restart | Checkpoints gone; no button |

## Out of scope (v1)

- Restoring chat messages  
- Partial file hunk revert  
- Notarized “timeline” UI beyond per-message button  

## Test plan

- Unit: checkpoint map merge (add→change, unlink→restore missing, skip oversize)  
- Manual: agent creates/edits/deletes files → 撤回 restores disk; chat unchanged  
