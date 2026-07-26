# Task 5 Report

**Status:** DONE (automated tests pass; manual jsonl verify not run in CI)

**Commits:** `6c92d88` — `feat: integrate Pi SDK workers and session file listing`

**Tests:** `npm test` — 10/10 passed (incl. `session-list.test.ts`, `session-broker.test.ts`)

**npm install:** Root `npm install` failed (`EBUSY` on `node_modules/electron`). Installed Pi deps in `%TEMP%/pi-desktop-pi-deps` and copied packages into `node_modules`; `package.json` + `package-lock.json` updated.

**Concerns:** `npm run build` / `vue-tsc` fail in this workspace (broken `.ignored` dev deps from partial install). Restore with full `npm install` when Electron is not locked. Worker init requires Pi models/auth for real prompts.

**Deliverables:** Real SDK in `runtime.ts`, disk `listSessionsForCwd`, broker open/list merge, sidebar wired with workspace gate.

---

## Review fix (sessions.status + randomUUID)

**Changes:** Preload `sessions.status(sessionId, cwd)` aligned with `sessions-ipc.ts`; removed `node:crypto` `randomUUID` import (use global `crypto.randomUUID()` for command ids).

**Tests:** `npm test` — 6 files, 10/10 passed (2026-07-27).

```
 RUN  v3.2.7 C:/MyCode/golang/pi-desktop
 ✓ tests/shared/path-sandbox.test.ts (2 tests)
 ✓ tests/shared/protocol.test.ts (1 test)
 ✓ tests/main/workspace-store.test.ts (1 test)
 ✓ tests/renderer/layout-clamp.test.ts (4 tests)
 ✓ tests/main/session-broker.test.ts (1 test)
 ✓ tests/main/session-list.test.ts (1 test)
 Test Files  6 passed (6)
      Tests  10 passed (10)
   Duration  1.27s
```

**Renderer:** No call sites for `window.api.sessions.status` (status shown via list/events).
