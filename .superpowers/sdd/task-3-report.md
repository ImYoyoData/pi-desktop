# Task 3 Report: IPC + preload + protocol (git conflict APIs)

## Status

**Complete**

## Changes

| File | Change |
|------|--------|
| `src/shared/protocol.ts` | Added `IpcChannels.git`: `conflictContent`, `resolveConflict`, `checkoutConflictSide`, `abortMerge` |
| `src/main/git-ipc.ts` | Registered four handlers; delegate to `getConflictContent`, `resolveConflictPath`, `checkoutConflictSide`, `abortMerge` from `git-host.ts` |
| `src/preload/index.ts` | Exposed matching methods on `api.git` with `GitConflictContentResult` / `GitOpResult` types |

## Handler behavior

- All handlers call `requireRoot()` first.
- `conflictContent`: missing workspace or non-string path → `{ supported: false }` (same as `git.diff`).
- `resolveConflict`, `checkoutConflictSide`, `abortMerge`: missing workspace or invalid payload → `noWorkspace()` (`GitOpResult` with `invalid_args`).
- `checkoutConflictSide` validates `side` is `"ours"` or `"theirs"`.

## Verification

```text
npm run typecheck  → exit 0 (vue-tsc --noEmit)
```

## Commit

- **Message:** `feat: expose git conflict resolve IPC to renderer`
- **Files staged:** only the three files above (no Cursor attribution).

## Renderer API

```ts
window.api.git.conflictContent(relativePath)
window.api.git.resolveConflict({ relativePath, content })
window.api.git.checkoutConflictSide({ relativePath, side: "ours" | "theirs" })
window.api.git.abortMerge()
```

## Notes / concerns

- Invalid mutation payloads reuse `noWorkspace()` rather than a dedicated `invalid_args` message; consistent with several existing git IPC handlers.
- Task 4+ can consume these APIs from the renderer conflict UI.
