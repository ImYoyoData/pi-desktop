# Task 5 Report: Worker permission gate + RPC ask

**Date:** 2026-07-28  
**Status:** Complete (+ Important review fixes)  
**Commits:** none (per instructions)

## What landed

1. **`src/agent-worker/permission-gate.ts`** — `createPermissionGate` with mockable `askUser`; unit tests in `tests/agent-worker/permission-gate.test.ts` (8 cases after review fixes).
2. **`runtime.ts`** — init takes `desktopSecurity` snapshot; `reload_security` inbound; `sessionAllows` per worker; composes `created.agent.beforeToolCall` with existing extension hook.
3. **RPC** — `desktop.permissionAsk` via `rpcToMain` with `PERMISSION_ASK_TIMEOUT_MS` (10 min); main router in `index.ts` → `askRendererPermission` → `sessions:permission` / `sessions:permissionReply`.
4. **Hot reload** — `notifyWorkersReloadSecurity` on `security.set`; init snapshot from `getDesktopSecuritySettings` in `agent-worker-host`.
5. **Minimal UI** — stub `PermissionStrip.vue` (3 buttons) + chat store pending + preload IPC (Task 6 can polish).

## Verification

- `vitest run` permission-gate + desktop-security + chat-reducer: **43 passed**
- `npm run typecheck`: **pass**

## Concerns / follow-ups for Task 6

- Permission ask for a non-active session still blocks the worker; strip only shows on the active session until UI switches or times out.
- Strip styling/copy is minimal; ask_user vs permission overlap UX can be refined (permission already mounted above ask_user).
- No bash `exec` second-line wrapper yet (design optional; Task 8 / later).

## Review Important fixes (2026-07-28)

Addressed the three Important items from `task-5-review.md`:

1. **No-UI fail-fast** — `askRendererPermission` now rejects immediately with `permission UI unavailable` when `BrowserWindow.getAllWindows().length === 0` (no 10‑min wait).
2. **Clear strip on main timeout** — On timer expiry and `clearPendingPermissionAsks`, main broadcasts `sessions:permission` with `{ sessionId, requestId, cancelled: true }`. Renderer `onPermission` clears matching `pendingPermission`. Worker RPC still rejects (deny), never resolves as allow. Types: `PermissionAskPrompt | PermissionAskCancelled`.
3. **Exhaustive `evaluatePermission`** — Gate uses `switch` + `never` default; `deny` returns `{ block: true, reason }` without `askUser`. Unit test stubs `evaluate` to force deny.

### Re-verification

- `vitest run` permission-gate + desktop-security + project-trust: **28 passed** (permission-gate **8**)
- `npm run typecheck`: **pass**
