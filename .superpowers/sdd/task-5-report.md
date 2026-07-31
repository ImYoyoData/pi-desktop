# Task 5 Report: Wire ChangesConflictResolve into ChangesTab.vue

## Status

**Complete**

## Summary

Wired merge conflict resolution into the Changes tab per `task-5-brief.md`.

### Changes (`ChangesTab.vue`)

1. **State** — Added `conflictPayload` ref; cleared on non-git refresh and when leaving conflict files.

2. **`loadDiff`** — For files with `status === "conflict"` or `code === "C"`, calls `window.api.git.conflictContent`; on success sets `conflictPayload` and skips normal diff. Falls through to `diff()` when unsupported or non-conflict.

3. **Handlers** — `onConflictResolve`, `onConflictAcceptSide`, `onAbortMerge` use existing `runOp` + i18n success labels.

4. **Template** — Conflict banner includes `t.changesConflictBannerAction` abort button. Diff pane renders `ChangesConflictResolve` when `conflictPayload && selectedPath`; otherwise unchanged diff UI.

5. **Styles** — Banner uses flex layout for text + abort button.

## Commit

- **Hash:** `f227612`
- **Message:** `feat: wire conflict resolve pane into Changes tab`
- **Files:** `src/renderer/src/components/ChangesTab.vue` only

## Verification

| Command | Result |
|---------|--------|
| `npx vitest run tests/renderer/conflict-markers.test.ts tests/main/git-host-dugite.test.ts` | 11/11 passed |
| `npm run typecheck` | passed |

## Concerns

- None blocking. Conflict pane shares diff header (filename, discard); discard on conflict files still calls `restore` — pre-existing behavior, not changed in this task.
- Manual UI smoke with a real merge conflict in the app was not run in this session.

## i18n

No new keys; used existing `changesConflictResolved`, `changesConflictAborted`, `changesConflictAbort`, `changesConflictBannerAction`.
