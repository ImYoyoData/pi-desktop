# Task 11 report

**Status:** DONE

**Deliverables:** `worker-lifecycle.ts` + `IDLE_WORKER_DESTROY_MS` (10m); `session-broker` idle destroy, cold-start on `send`/`open`, `pendingCommands` reject on fatal/kill/terminate; `SessionSidebar` stuck banner + Terminate/Restart; `README.md` install/dev/rebuild/platforms + acceptance table + known env issues; removed unused `tests/mocks/*`.

**Tests:** `npm test` — 31/31. `npm run typecheck` — pass.

**Verify:** Electron dev / manual E2E not run (EBUSY / electron install); deferred checks documented in README.

**Commit:** `bbe0287` — `feat: harden worker lifecycle and document v1 acceptance`

## Final review fixes

- **Right pane tabs:** `RightPane.vue` keeps Terminal/Preview/Browser mounted with `v-show`; `BrowserTab` zeroes WebContentsView bounds when hidden.
- **Status sync:** Broker emits `session_status` on every status transition (including stuck→idle on pong and after hang completes); renderer `sessions` store applies it for sidebar dots.
- **Hang UI removed** from `SessionSidebar` (worker `hang` command retained for tests).
- **Chat hydrate:** `sessions:history` parses jsonl leaf-path user/assistant messages; loaded on session select.
- **Delete session:** `sessions:delete` removes jsonl + broker record; sidebar delete with confirm dialog.
- **Deferred:** Session rename UI (SDK `set_session_name` / file rename not wired).
- **Tests:** `npm test` — 34/34 (added `session-history`, broker `session_status` recovery test).
- **Commit:** `fix: preserve right-pane tabs and sync stuck status`
