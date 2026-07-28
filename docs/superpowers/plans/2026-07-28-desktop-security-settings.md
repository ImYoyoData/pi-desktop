# Desktop Security Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align Pi Desktop with SDK project trust (`trust.json` + `projectTrusted`), and add Security settings for per-category ask/allow (`bash` / `write` / `network`), bash allowlist, and an in-chat permission confirmation strip.

**Architecture:** Main resolves/writes trust via SDK `ProjectTrustStore` and shows a trust dialog on open. Agent-worker creates `SettingsManager` with explicit `projectTrusted` (stop defaulting trusted). Tool approval runs in `session.agent.beforeToolCall`, using existing `rpcToMain` to ask the renderer; decisions use `desktopSecurity` in `~/.pi/agent/settings.json` plus in-memory session allows. UI: `SecuritySettings` panel + `PermissionStrip` + `TrustDialog`.

**Tech Stack:** Electron, Vue 3, Pinia, Naive UI, `@earendil-works/pi-coding-agent` (`ProjectTrustStore`, `hasTrustRequiringProjectResources`, `SettingsManager`), Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-desktop-security-settings-design.md`
- Never bypass trust checks; never let Agent write `trust.json`; never break cwd path isolation.
- `auth.json` remains global-only.
- Defaults: `bash`/`write`/`network` = `"ask"`; `bashAllowlist` = `[]`.
- Bash allowlist: trim + **prefix match** only when `bash === "ask"`.
- Permission deny: return tool error, **no auto-retry bypass**; explain remediations.
- Network category: if no network tool exists, UI reserved/disabled — do not fake interception.
- Do not commit unless the user explicitly asks (user rule overrides “frequent commits” — treat commit steps as optional).
- Reply / UI copy: zh-CN + en i18n keys.

## File map

| Area | Primary files |
|------|----------------|
| Shared security types + pure logic | Create `src/shared/desktop-security.ts`; Test `tests/shared/desktop-security.test.ts` |
| Trust helpers (main) | Create `src/main/project-trust.ts`; Test `tests/main/project-trust.test.ts` |
| Settings I/O | Create `src/main/desktop-security-host.ts`; wire `src/shared/protocol.ts`, `src/preload/index.ts` |
| Workspace open + dialog | Modify `src/main/workspace-ipc.ts`, `src/renderer/src/stores/workspace.ts`; Create `src/renderer/src/components/TrustDialog.vue` |
| Worker trust + gate | Modify `src/agent-worker/runtime.ts`, `src/shared/agent-worker-messages.ts`, `src/agent-worker/main-rpc.ts`; Create `src/agent-worker/permission-gate.ts` |
| Main permission bridge | Modify `src/main/session-broker.ts` (or dedicated host); Modify chat event path |
| Permission UI | Create `src/renderer/src/components/PermissionStrip.vue`; Modify `src/renderer/src/components/ChatPanel.vue`, `src/renderer/src/stores/chat.ts` / `chat-reducer.ts` |
| Settings UI | Create `src/renderer/src/components/SecuritySettings.vue`; Modify `src/renderer/src/components/TitleBar.vue`; i18n `en.ts` / `zh-CN.ts` |

---

### Task 1: Shared `desktopSecurity` types + allowlist matching

**Files:**
- Create: `src/shared/desktop-security.ts`
- Test: `tests/shared/desktop-security.test.ts`

**Interfaces:**
- Produces:
  - `export type SecurityMode = "ask" | "allow"`
  - `export type SecurityCategory = "bash" | "write" | "network"`
  - `export type DesktopSecuritySettings = { bash: SecurityMode; write: SecurityMode; network: SecurityMode; bashAllowlist: string[] }`
  - `export const DEFAULT_DESKTOP_SECURITY: DesktopSecuritySettings`
  - `export function parseDesktopSecurity(raw: unknown): DesktopSecuritySettings`
  - `export function bashAllowlistMatches(command: string, allowlist: string[]): boolean`
  - `export function classifyToolName(toolName: string): SecurityCategory | null` — `bash`→bash; `edit`/`write`→write; known network names→network; else `null`
  - `export type PermissionDecision = "allow_once" | "allow_session_category" | "deny"`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  bashAllowlistMatches,
  classifyToolName,
  parseDesktopSecurity,
  DEFAULT_DESKTOP_SECURITY,
} from "../../src/shared/desktop-security";

describe("parseDesktopSecurity", () => {
  it("defaults when missing", () => {
    expect(parseDesktopSecurity(undefined)).toEqual(DEFAULT_DESKTOP_SECURITY);
  });
  it("reads nested desktopSecurity object", () => {
    expect(
      parseDesktopSecurity({
        desktopSecurity: { bash: "allow", write: "ask", network: "ask", bashAllowlist: ["git status"] },
      }),
    ).toMatchObject({ bash: "allow", bashAllowlist: ["git status"] });
  });
  it("ignores invalid modes", () => {
    expect(parseDesktopSecurity({ desktopSecurity: { bash: "nope" } }).bash).toBe("ask");
  });
});

describe("bashAllowlistMatches", () => {
  it("prefix matches after trim", () => {
    expect(bashAllowlistMatches("  git status --short ", ["git status"])).toBe(true);
    expect(bashAllowlistMatches("git push", ["git status"])).toBe(false);
  });
});

describe("classifyToolName", () => {
  it("maps bash/edit/write", () => {
    expect(classifyToolName("bash")).toBe("bash");
    expect(classifyToolName("edit")).toBe("write");
    expect(classifyToolName("write")).toBe("write");
    expect(classifyToolName("read")).toBe(null);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run tests/shared/desktop-security.test.ts`  
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `src/shared/desktop-security.ts`**

```ts
export type SecurityMode = "ask" | "allow";
export type SecurityCategory = "bash" | "write" | "network";
export type PermissionDecision = "allow_once" | "allow_session_category" | "deny";

export type DesktopSecuritySettings = {
  bash: SecurityMode;
  write: SecurityMode;
  network: SecurityMode;
  bashAllowlist: string[];
};

export const DEFAULT_DESKTOP_SECURITY: DesktopSecuritySettings = {
  bash: "ask",
  write: "ask",
  network: "ask",
  bashAllowlist: [],
};

function asMode(v: unknown): SecurityMode {
  return v === "allow" || v === "ask" ? v : "ask";
}

export function parseDesktopSecurity(raw: unknown): DesktopSecuritySettings {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ds =
    root.desktopSecurity && typeof root.desktopSecurity === "object"
      ? (root.desktopSecurity as Record<string, unknown>)
      : root;
  const list = Array.isArray(ds.bashAllowlist)
    ? ds.bashAllowlist.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  return {
    bash: asMode(ds.bash),
    write: asMode(ds.write),
    network: asMode(ds.network),
    bashAllowlist: list.map((s) => s.trim()),
  };
}

export function bashAllowlistMatches(command: string, allowlist: string[]): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  return allowlist.some((entry) => {
    const e = entry.trim();
    return e.length > 0 && (cmd === e || cmd.startsWith(`${e} `) || cmd.startsWith(`${e}\t`));
  });
}

const NETWORK_TOOLS = new Set<string>([
  // Reserve names used by future/desktop network tools; empty effective set is OK.
]);

export function classifyToolName(toolName: string): SecurityCategory | null {
  const n = toolName.trim().toLowerCase();
  if (n === "bash") return "bash";
  if (n === "edit" || n === "write") return "write";
  if (NETWORK_TOOLS.has(n)) return "network";
  return null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run tests/shared/desktop-security.test.ts`

- [ ] **Step 5: Commit (optional)** — `feat: add desktopSecurity shared types and allowlist matching`

---

### Task 2: Project trust helpers + IPC

**Files:**
- Create: `src/main/project-trust.ts`
- Create: `src/main/desktop-security-host.ts` (also read/write settings.json `desktopSecurity` — used by Task 7; implement get/set here)
- Modify: `src/shared/protocol.ts` — add `security.*` and `trust.*` channels
- Modify: `src/preload/index.ts` — expose API
- Modify: `src/main/index.ts` — register IPC
- Test: `tests/main/project-trust.test.ts`

**Interfaces:**
- Consumes: `ProjectTrustStore`, `hasTrustRequiringProjectResources`, `getAgentDir` from `@earendil-works/pi-coding-agent`
- Produces:
  - `export type TrustPromptKind = "none" | "ask"`
  - `export function resolveTrustState(cwd: string): { decision: boolean | null; needsResources: boolean; prompt: TrustPromptKind; projectTrusted: boolean }`
  - `export function setProjectTrust(cwd: string, trusted: boolean): void`
  - `export function clearProjectTrust(cwd: string): void` — `set(cwd, null)` if store supports null
  - IPC: `trust.get`, `trust.set`, `trust.clear`, `security.get`, `security.set`

Trust resolution rules (match SDK security.md + Desktop dialog):
- `needsResources = hasTrustRequiringProjectResources(cwd)`
- `decision = trustStore.get(cwd)` (`true` | `false` | `null`)
- If `!needsResources` → `projectTrusted: true`, `prompt: "none"` (nothing to gate)
- If `decision === true` → `projectTrusted: true`, `prompt: "none"`
- If `decision === false` → `projectTrusted: false`, `prompt: "none"`
- If `decision === null && needsResources` → `projectTrusted: false` (safe until user answers), `prompt: "ask"`

- [ ] **Step 1: Failing test for resolveTrustState** using temp dirs + temp agentDir with/without `.pi/settings.json` and trust.json entries (mirror other main tests’ tmp patterns in `tests/main/`).

- [ ] **Step 2: Implement `project-trust.ts` + register IPC**

```ts
import { getAgentDir, hasTrustRequiringProjectResources, ProjectTrustStore } from "@earendil-works/pi-coding-agent";

export function resolveTrustState(cwd: string, agentDir = getAgentDir()) {
  const store = new ProjectTrustStore(agentDir);
  const needsResources = hasTrustRequiringProjectResources(cwd);
  const decision = store.get(cwd);
  if (!needsResources) {
    return { decision, needsResources, prompt: "none" as const, projectTrusted: true };
  }
  if (decision === true) {
    return { decision, needsResources, prompt: "none" as const, projectTrusted: true };
  }
  if (decision === false) {
    return { decision, needsResources, prompt: "none" as const, projectTrusted: false };
  }
  return { decision: null, needsResources, prompt: "ask" as const, projectTrusted: false };
}

export function setProjectTrust(cwd: string, trusted: boolean, agentDir = getAgentDir()): void {
  new ProjectTrustStore(agentDir).set(cwd, trusted);
}
```

`desktop-security-host.ts`: read `path.join(getAgentDir(), "settings.json")`, parse JSON, `parseDesktopSecurity`, on set merge `{ ...existing, desktopSecurity: next }` with file lock best-effort (read-modify-write; document race acceptable for v1).

- [ ] **Step 3: Pass tests + `npm run typecheck`**

- [ ] **Step 4: Commit (optional)**

---

### Task 3: Trust dialog on workspace open + pass `projectTrusted` into worker

**Files:**
- Create: `src/renderer/src/components/TrustDialog.vue`
- Modify: `src/renderer/src/stores/workspace.ts` — after successful open/get, if `trust.get` says `prompt==="ask"`, set `pendingTrustPrompt` and await user choice before considering workspace “ready” for sessions
- Modify: `src/renderer/src/App.vue` or `WelcomeView`/`SplitRoot` mount point — render `TrustDialog`
- Modify: `src/agent-worker/runtime.ts` — `init` must receive `projectTrusted: boolean` and use `SettingsManager.create(cwd, agentDir, { projectTrusted })` passed into `createAgentSessionServices({ settingsManager })`
- Modify: worker spawn / `session-broker` / inbound `init` message to include `projectTrusted`
- Modify: `src/shared/agent-worker-messages.ts` — `init: { cwd, filePath?, projectTrusted: boolean }`
- i18n keys for trust dialog

**Interfaces:**
- Consumes: Task 2 IPC `trust.*`, `resolveTrustState`
- Produces: worker always starts with explicit trust; dialog choices:
  - Trust → `trust.set(true)` then proceed `projectTrusted=true` (restart workers if already running)
  - Don't trust → `trust.set(false)`, proceed `projectTrusted=false`
  - Later → do not write; proceed `projectTrusted=false` this session only

- [ ] **Step 1: Extend WorkerInbound init**

```ts
| { kind: "init"; cwd: string; filePath?: string; projectTrusted: boolean }
```

- [ ] **Step 2: In `runtime.ts` initSession**

```ts
import { SettingsManager } from "@earendil-works/pi-coding-agent";

const settingsManager = SettingsManager.create(cwd, agentDir, {
  projectTrusted: Boolean(projectTrusted),
});
const services = await createAgentSessionServices({
  cwd,
  agentDir,
  settingsManager,
  resourceLoaderOptions: { appendSystemPrompt: [/* existing */] },
});
```

Ensure session-broker computes `projectTrusted` via `resolveTrustState(cwd).projectTrusted` (after dialog resolved) when spawning/initing workers.

- [ ] **Step 3: TrustDialog UI** — Naive `NModal` with title/body explaining project `.pi` resources; three buttons. Wire workspace store flow so open folder blocks session hydrate until answered when `prompt==="ask"`.

- [ ] **Step 4: Manual check** — open untrusted repo with `.pi/settings.json` → dialog; Trust → skills/extensions from project load; Don't trust → they don't.

- [ ] **Step 5: Commit (optional)**

---

### Task 4: Permission decision pure function

**Files:**
- Modify: `src/shared/desktop-security.ts` — add `evaluatePermission`
- Test: extend `tests/shared/desktop-security.test.ts`

**Interfaces:**
- Produces:

```ts
export type PermissionEval =
  | { action: "allow"; reason: "mode_allow" | "allowlist" | "session" }
  | { action: "ask" }
  | { action: "deny"; reason: string };

export function evaluatePermission(input: {
  category: SecurityCategory;
  settings: DesktopSecuritySettings;
  command?: string; // bash only
  sessionAllows: Set<SecurityCategory>;
}): PermissionEval
```

Rules:
1. If `sessionAllows.has(category)` → allow session
2. If `settings[category] === "allow"` → allow mode_allow
3. If category bash and `bashAllowlistMatches(command, settings.bashAllowlist)` → allow allowlist
4. Else → ask

(Deny is only from user / timeout — not from evaluatePermission.)

- [ ] **Step 1: Tests for allow / allowlist / ask / session**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Pass tests**
- [ ] **Step 4: Commit (optional)**

---

### Task 5: Worker permission gate + RPC ask

**Files:**
- Create: `src/agent-worker/permission-gate.ts`
- Modify: `src/agent-worker/runtime.ts` — after session create, set `created.agent.beforeToolCall`
- Modify: `src/agent-worker/main-rpc.ts` — support long timeout for permission RPC (e.g. 10 minutes)
- Modify: main RPC router (where `rpc_request` is handled — find in `session-broker` / browser host) to handle method `desktop.permissionAsk`
- Modify: WorkerInbound — already has `rpc_response`

**Interfaces:**
- Consumes: `evaluatePermission`, `classifyToolName`, `parseDesktopSecurity`, `rpcToMain`
- Produces: gate that blocks until UI responds

`permission-gate.ts` sketch:

```ts
export function createPermissionGate(opts: {
  getSettings: () => DesktopSecuritySettings;
  sessionAllows: Set<SecurityCategory>;
  askUser: (req: {
    category: SecurityCategory;
    toolName: string;
    summary: string;
  }) => Promise<PermissionDecision>;
}) {
  return async (ctx: BeforeToolCallContext): Promise<BeforeToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;
    const category = classifyToolName(toolName);
    if (!category) return undefined;
    const args = ctx.args as Record<string, unknown>;
    const command = typeof args.command === "string" ? args.command : undefined;
    const summary =
      category === "bash"
        ? String(command ?? "")
        : String(args.path ?? args.filePath ?? JSON.stringify(args).slice(0, 200));
    const ev = evaluatePermission({
      category,
      settings: opts.getSettings(),
      command,
      sessionAllows: opts.sessionAllows,
    });
    if (ev.action === "allow") return undefined;
    let decision: PermissionDecision;
    try {
      decision = await opts.askUser({ category, toolName, summary });
    } catch {
      return { block: true, reason: "Permission prompt timed out or UI unavailable — denied." };
    }
    if (decision === "allow_session_category") {
      opts.sessionAllows.add(category);
      return undefined;
    }
    if (decision === "allow_once") return undefined;
    return {
      block: true,
      reason:
        "Blocked by Pi Desktop security settings. Open Settings → Security to allow, add a bash allowlist entry, or trust the workspace.",
    };
  };
}
```

Wire in `runtime.ts`:
- Load settings at init via reading settings.json in worker (`fs.readFile` + `parseDesktopSecurity`) OR receive snapshot on init and `reload_security` inbound message
- Prefer inbound `reload_security` + initial snapshot on `init` to avoid worker guessing paths — extend init: `{ ..., projectTrusted, desktopSecurity }`
- `sessionAllows` = `new Set()` per worker lifetime
- `created.agent.beforeToolCall = gate` (compose if already set)

Main `desktop.permissionAsk`:
- Forward to renderer: `webContents.send("sessions:permission", { sessionId, requestId, ... })`
- Wait for `sessions:permissionReply` invoke with decision
- Resolve rpc_response

- [ ] **Step 1: Implement gate unit-testable with mock `askUser`**
- [ ] **Step 2: Wire runtime + RPC + broker**
- [ ] **Step 3: Typecheck**
- [ ] **Step 4: Commit (optional)**

---

### Task 6: PermissionStrip UI

**Files:**
- Create: `src/renderer/src/components/PermissionStrip.vue`
- Modify: `src/renderer/src/components/ChatPanel.vue` — mount strip above composer (near `AskUserStrip`)
- Modify: `src/renderer/src/stores/chat.ts` (+ reducer if needed) — `pendingPermission: { sessionId, requestId, category, toolName, summary } | null`
- Modify: preload + protocol for permission event/reply
- i18n: allow once / allow category this session / deny / titles

**Interfaces:**
- Consumes: permission events from main
- Produces: reply IPC with `PermissionDecision`

Behavior:
- Mirror `AskUserStrip` layout (bottom card)
- Three buttons map to `allow_once` | `allow_session_category` | `deny`
- On deny/allow, clear pending and invoke reply
- If ask_user and permission both pending, prefer showing permission first (tool is blocked) or queue — **v1: permission takes priority**

- [ ] **Step 1: Store + strip + ChatPanel**
- [ ] **Step 2: Manual: set bash=ask, run agent `ls` → strip → Allow once executes; Deny shows tool error and stops**
- [ ] **Step 3: Commit (optional)**

---

### Task 7: SecuritySettings panel

**Files:**
- Create: `src/renderer/src/components/SecuritySettings.vue`
- Modify: `src/renderer/src/components/TitleBar.vue` — menu item + modal open state
- Modify: i18n en/zh-CN
- Use IPC `security.get` / `security.set`, `trust.get` / `trust.set` for current workspace

**UI contents:**
1. Current workspace trust status + Trust / Untrust buttons (calls trust IPC; if workers live, restart workers for cwd — reuse `sessions.restartWorker` / reopen pattern)
2. Radio or select per category: ask | allow for bash, write, network (network disabled + hint if `classifyToolName` never returns network / feature flag `networkGatingAvailable: false` constant)
3. Bash allowlist: `NDynamicTags` or input+list add/remove
4. Buttons: “全部询问” / “全部允许”
5. On save: `security.set` then broadcast `reload_security` to all workers

- [ ] **Step 1: Implement panel + menu entry**
- [ ] **Step 2: Persist round-trip — change bash to allow, restart app, value remains in `~/.pi/agent/settings.json`**
- [ ] **Step 3: Typecheck**
- [ ] **Step 4: Commit (optional)**

---

### Task 8: Hardening + acceptance pass

**Files:** touch as needed (messages, worker reload, edge cases)

- [ ] **Step 1: Permission timeout** — if UI never answers, deny with clear reason (already in gate)
- [ ] **Step 2: After trust change, recreate workers so `projectTrusted` applies (restart all sessions for workspace)
- [ ] **Step 3: When tool denied, ensure chat surfaces reason (existing tool error path) and optional toast pointing to Security settings
- [ ] **Step 4: Run full automated tests: `npx vitest run tests/shared/desktop-security.test.ts tests/main/project-trust.test.ts` (+ any new gate tests) and `npm run typecheck`
- [ ] **Step 5: Manual acceptance checklist from spec § Acceptance criteria**
- [ ] **Step 6: Commit (optional)** — `feat: desktop security settings (trust + tool approval)`

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| trust.json via ProjectTrustStore; Agent cannot write | 2, 3, 7 |
| Dialog on open untrusted + resources | 3 |
| SettingsManager `projectTrusted` (no silent default trust) | 3 |
| desktopSecurity in settings.json | 1, 2, 7 |
| Defaults all ask | 1 |
| Per-category ask/allow bash/write/network | 4, 5, 7 |
| Bash prefix allowlist | 1, 4 |
| Permission strip once/session/deny | 5, 6 |
| beforeToolCall gate + no bypass retry | 5, 8 |
| Network reserved if no tool | 1, 7 |
| Remediations on deny / trust failures | 5, 8 |

## Placeholder / consistency notes

- Method name for RPC: always `desktop.permissionAsk`
- Decision union: always `allow_once` | `allow_session_category` | `deny`
- Settings key: always `desktopSecurity` (nested in settings.json)
