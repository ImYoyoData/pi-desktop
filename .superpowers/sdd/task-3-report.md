# Task 3 Report: Trust dialog on workspace open + pass `projectTrusted` into worker

## Status

**Complete.** Workspace open/get gates session hydrate on trust prompt; workers init with explicit `projectTrusted` via `SettingsManager.create`.

## Commits

None (per instructions).

## Changes

| File | Summary |
|------|---------|
| `src/shared/agent-worker-messages.ts` | `init` requires `projectTrusted: boolean` |
| `src/agent-worker/runtime.ts` | `SettingsManager.create(cwd, agentDir, { projectTrusted })` → `createAgentSessionServices` |
| `src/main/agent-worker-host.ts` | Spawn resolves `resolveTrustState(cwd).projectTrusted` into init |
| `src/renderer/src/stores/workspace.ts` | `pendingTrustPrompt` / `sessionsReady`; Trust / Don't trust / Later; await before ready |
| `src/renderer/src/components/TrustDialog.vue` | Naive `NModal` (non-dismissible) with three actions |
| `src/renderer/src/App.vue` | Mount `TrustDialog` |
| `src/renderer/src/components/SessionSidebar.vue` | Hydrate only when `root && sessionsReady` |
| `src/renderer/src/i18n/en.ts` / `zh-CN.ts` | Trust dialog strings |
| `src/renderer/components.d.ts` | Register `TrustDialog` |

## Behavior

- **Trust** → `trust.set(true)` → proceed; restart live workers for cwd (best-effort).
- **Don't trust** → `trust.set(false)` → `projectTrusted=false`.
- **Later** → no write; session-local defer until workspace root changes; `projectTrusted=false`.
- Worker spawn always uses `resolveTrustState(cwd).projectTrusted` (safe default `false` while unresolved).

## Tests

```
npm run typecheck → pass
npx vitest run tests/main/project-trust.test.ts tests/main/session-broker.test.ts tests/shared/desktop-security.test.ts
→ 20 passed
```

Manual check (Step 4) not run in this environment: open untrusted repo with `.pi/settings.json` → dialog; Trust loads project resources; Don't trust does not.

## Self-review

- SDK default `projectTrusted ?? true` is overridden by explicit boolean on every worker init.
- Dialog `mask-closable` / `close-on-esc` / `closable` disabled so open blocks until a choice.
- Concurrent `getWorkspace` / open calls join the same in-flight trust wait promise.
- Session hydrate gated on `sessionsReady` so workers are not cold-started before the answer.

## Concerns / follow-ups

1. **No automated UI/store test** for TrustDialog / `sessionsReady` gate — covered by typecheck + trust unit tests; manual Step 4 still needed.
2. **plugins-host** still uses `SettingsManager.create(cwd, getAgentDir())` without `projectTrusted` — out of scope for Task 3 (worker path only); may over-trust when listing plugins from main.
3. **Trust → restart workers** is best-effort; with the hydrate gate, list is usually empty at answer time; Security settings (later) should still recreate workers on trust toggle.
4. Path equality for cancel/re-open uses string `===` (not normalized) — matches prior workspace IPC path strings.

## Out of scope (later tasks)

- PermissionStrip, SecuritySettings, `evaluatePermission`, `beforeToolCall` approval, `reload_security` / `desktopSecurity` on init.
