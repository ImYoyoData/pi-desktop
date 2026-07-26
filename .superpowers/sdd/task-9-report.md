# Task 9 report

**Status:** DONE

**Deliverables:** `preview-host.ts` + `preview-ipc.ts` (`readPreview` via `resolveWorkspacePath`); `PreviewTab.vue`; `MessageList` Preview buttons; preload `preview.read` / `preview.pickFile`; `RightPane` wired; shared `preview-types.ts`.

**TDD:** `tests/main/preview-host.test.ts` — 6 cases (text, markdown, image data URL, 1.5MB cap, unsupported, path escape → error). Red → green before UI.

**Tests:** `npm test` — 25/25. `npm run typecheck` — pass.

**Verify:** Manual preview of `.ts` / `.md` / `.png` and `../` denial not run in this session.

**Commit:** `f67e829` — `feat: add sandboxed file preview tab`

## Review fix: preview expand double-toggle

**Issue:** `MessageList.openPreview` and `RightPane` `openSignal` watch both called `toggleRightCollapsed` when collapsed → double-toggle left panel collapsed.

**Fix:** `MessageList` only calls `previewStore.openPreview`; `RightPane` watch is sole owner of expand + tab switch.

**Tests:** `npm test` — 25/25.

**Commit:** `fix: avoid double-toggle when opening preview from chat`
