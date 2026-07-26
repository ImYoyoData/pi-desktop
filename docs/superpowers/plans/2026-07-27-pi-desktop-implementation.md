# Pi Desktop Agent Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron + Vue3 Agent Workspace desktop app that runs Pi SDK in per-session workers, with Cursor-like chat, pi-web-like model settings, terminal, file preview, and browser element-select-to-chat.

**Architecture:** electron-vite app with Main `SessionBroker` routing IPC to one `utilityProcess` AgentWorker per session; Renderer is a three-column Agent Workspace (sessions | chat | right tabs). Terminal, preview, and browser stay in Main; agents never share one Node event loop.

**Tech Stack:** Electron, electron-vite, Vue 3, TypeScript, Vitest, `@earendil-works/pi-coding-agent` (pin compatible with local pi; start from `0.82.1`), `node-pty`, `xterm.js`, `splitpanes`, Pinia.

**Spec:** `docs/superpowers/specs/2026-07-27-pi-desktop-design.md`

## Global Constraints

- Platforms v1: Windows + macOS only (no Linux packaging).
- Data dir: reuse `~/.pi/agent` (honor `PI_CODING_AGENT_DIR` if set).
- One AgentWorker (`utilityProcess`) per chat session; multi-session concurrency required.
- Layout: Agent Workspace (not IDE) — left sessions, center chat, right tabs.
- Right pane shared globally across sessions in v1.
- Chat UX: Cursor-like; model settings: pi-web-like.
- Path reads for preview sandboxed to workspace root.
- Conventional commits; frequent commits per task.
- Prefer small focused files; put shared IPC types in `src/shared/`.

---

## File map (create during tasks)

```text
pi-desktop/
  package.json
  electron.vite.config.ts
  tsconfig*.json
  vitest.config.ts
  src/
    shared/
      protocol.ts
      path-sandbox.ts
      session-status.ts
    main/
      index.ts
      window.ts
      workspace-store.ts
      session-broker.ts
      agent-worker-host.ts
      models-config.ts
      terminal-host.ts
      browser-host.ts
      preview-host.ts
      session-list.ts
    preload/
      index.ts
    agent-worker/
      index.ts
      runtime.ts
    renderer/
      index.html
      src/
        main.ts
        App.vue
        styles.css
        stores/workspace.ts
        stores/sessions.ts
        stores/chat.ts
        stores/layout.ts
        stores/composer.ts
        stores/right-pane.ts
        components/
          WelcomeView.vue
          TopBar.vue
          SessionSidebar.vue
          ChatPanel.vue
          MessageList.vue
          Composer.vue
          CitationCard.vue
          ModelsSettings.vue
          RightPane.vue
          TerminalTab.vue
          PreviewTab.vue
          BrowserTab.vue
          SplitRoot.vue
  tests/
    shared/path-sandbox.test.ts
    shared/protocol.test.ts
    main/session-broker.test.ts
    main/workspace-store.test.ts
    main/session-list.test.ts
    main/models-config.test.ts
    main/preview-host.test.ts
    renderer/chat-reducer.test.ts
```

---

### Task 1: Scaffold electron-vite + shared protocol

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `src/shared/protocol.ts`, `src/shared/path-sandbox.ts`, `tests/shared/protocol.test.ts`, `tests/shared/path-sandbox.test.ts`, `src/main/index.ts`, `src/main/window.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/App.vue`, `.gitignore`
- Modify: none (greenfield)

**Interfaces:**
- Consumes: none
- Produces: `IpcChannels`, `AgentCommand`, `AgentEvent`, `isPathInsideRoot(root, candidate) => boolean`, `resolveWorkspacePath(root, rel) => string`

- [ ] **Step 1: Scaffold the app**

```bash
cd C:\MyCode\golang\pi-desktop
npm create @quick-start/electron@latest . -- --template vue-ts
```

If the tool refuses non-empty dirs, scaffold into a temp folder and move `package.json`, configs, and `src/` into the repo root **without deleting** `docs/`.

Ensure scripts include at least:

```json
{
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "test": "vitest run",
    "typecheck": "vue-tsc --noEmit -p tsconfig.json"
  }
}
```

- [ ] **Step 2: Write failing path-sandbox tests**

```ts
// tests/shared/path-sandbox.test.ts
import { describe, expect, it } from "vitest";
import { isPathInsideRoot, resolveWorkspacePath } from "../../src/shared/path-sandbox";
import path from "node:path";

describe("path-sandbox", () => {
  const root = path.resolve("/tmp/workspace-demo");

  it("allows files inside root", () => {
    const p = resolveWorkspacePath(root, "src/a.ts");
    expect(isPathInsideRoot(root, p)).toBe(true);
  });

  it("denies .. escape", () => {
    expect(() => resolveWorkspacePath(root, "../outside.txt")).toThrow(/escape|outside/i);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `npm test -- tests/shared/path-sandbox.test.ts`  
Expected: FAIL (module missing or function not implemented)

- [ ] **Step 4: Implement path-sandbox + protocol**

```ts
// src/shared/path-sandbox.ts
import path from "node:path";

export function resolveWorkspacePath(root: string, relativeOrAbsolute: string): string {
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, relativeOrAbsolute);
  if (!isPathInsideRoot(rootResolved, candidate)) {
    throw new Error(`Path escapes workspace root: ${relativeOrAbsolute}`);
  }
  return candidate;
}

export function isPathInsideRoot(root: string, candidate: string): boolean {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  const rel = path.relative(rootResolved, candidateResolved);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
```

```ts
// src/shared/protocol.ts
export const IpcChannels = {
  workspace: {
    get: "workspace:get",
    open: "workspace:open",
    openPath: "workspace:openPath",
    listRecent: "workspace:listRecent",
  },
  sessions: {
    list: "sessions:list",
    create: "sessions:create",
    open: "sessions:open",
    close: "sessions:close",
    command: "sessions:command",
    event: "sessions:event",
    status: "sessions:status",
    killWorker: "sessions:killWorker",
    restartWorker: "sessions:restartWorker",
  },
  models: {
    get: "models:get",
    set: "models:set",
    test: "models:test",
  },
  terminal: {
    create: "terminal:create",
    write: "terminal:write",
    resize: "terminal:resize",
    data: "terminal:data",
    dispose: "terminal:dispose",
  },
  preview: {
    read: "preview:read",
  },
  browser: {
    create: "browser:create",
    navigate: "browser:navigate",
    back: "browser:back",
    forward: "browser:forward",
    reload: "browser:reload",
    startSelect: "browser:startSelect",
    stopSelect: "browser:stopSelect",
    elementSelected: "browser:elementSelected",
    setBounds: "browser:setBounds",
    destroy: "browser:destroy",
  },
} as const;

export type SessionStatus = "idle" | "running" | "error" | "stuck";

export type AgentCommand =
  | { type: "prompt"; message: string; images?: unknown[]; citations?: ElementCitation[] }
  | { type: "steer"; message: string }
  | { type: "follow_up"; message: string }
  | { type: "abort" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: string }
  | { type: "compact"; customInstructions?: string }
  | { type: "get_state" }
  | { type: "ping" }
  | { type: "hang" };

export type ElementCitation = {
  url: string;
  selector: string;
  text: string;
  htmlSnippet: string;
};

export type AgentEvent =
  | { type: "connected"; sessionId: string }
  | { type: "agent_event"; sessionId: string; event: Record<string, unknown> }
  | { type: "prompt_done"; sessionId: string }
  | { type: "prompt_error"; sessionId: string; errorMessage: string }
  | { type: "worker_stuck"; sessionId: string }
  | { type: "worker_exit"; sessionId: string; code: number | null };

export type SessionSummary = {
  id: string;
  filePath: string;
  cwd: string;
  name?: string;
  modified: string;
  firstMessage?: string;
  status: SessionStatus;
};
```

Add `tests/shared/protocol.test.ts` asserting all leaf channel strings are unique.

- [ ] **Step 5: Run tests — expect PASS**

Run: `npm test`  
Expected: PASS

- [ ] **Step 6: Minimal window boots**

`src/main/window.ts` creates `BrowserWindow` loading electron-vite renderer URL.  
`App.vue` shows `Pi Desktop` text.  
Run: `npm run dev`  
Expected: empty window with title text, no crash.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig*.json vitest.config.ts src tests .gitignore
git commit -m "chore: scaffold electron-vite app and shared IPC protocol"
```

---

### Task 2: Workspace open / recent projects

**Files:**
- Create: `src/main/workspace-store.ts`, `src/renderer/src/stores/workspace.ts`, `src/renderer/src/components/WelcomeView.vue`, `src/renderer/src/components/TopBar.vue`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/App.vue`
- Test: `tests/main/workspace-store.test.ts`

**Interfaces:**
- Consumes: `IpcChannels.workspace.*`
- Produces: `createWorkspaceStore(statePath)`, `getWorkspace()`, `openWorkspace()`, `openWorkspacePath(root)`, `listRecent()`

- [ ] **Step 1: Write failing persistence test**

```ts
// tests/main/workspace-store.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkspaceStore } from "../../src/main/workspace-store";

describe("workspace-store", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-ws-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("remembers recent roots newest-first unique", () => {
    const store = createWorkspaceStore(path.join(dir, "state.json"));
    store.addRecent("/a");
    store.addRecent("/b");
    store.addRecent("/a");
    expect(store.listRecent()).toEqual(["/a", "/b"]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/main/workspace-store.test.ts`

- [ ] **Step 3: Implement store + IPC + UI**

Persist to `app.getPath("userData")/workspace-state.json`.  
`openWorkspace` uses `dialog.showOpenDialog({ properties: ["openDirectory"] })`.  
Welcome view: recent list + Open Folder.  
TopBar shows current root or “No folder”.  
`App.vue`: if no root → `WelcomeView`, else shell placeholder.

Preload:

```ts
workspace: {
  get: () => ipcRenderer.invoke(IpcChannels.workspace.get),
  open: () => ipcRenderer.invoke(IpcChannels.workspace.open),
  listRecent: () => ipcRenderer.invoke(IpcChannels.workspace.listRecent),
  openPath: (root: string) => ipcRenderer.invoke(IpcChannels.workspace.openPath, root),
}
```

- [ ] **Step 4: Manual verify**

Run: `npm run dev`  
Expected: open folder; restart shows recent; TopBar updates.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: add Cursor-style workspace open and recent projects"
```

---

### Task 3: Three-column resizable Agent Workspace shell

**Files:**
- Create: `src/renderer/src/components/SplitRoot.vue`, `src/renderer/src/components/SessionSidebar.vue`, `src/renderer/src/components/ChatPanel.vue`, `src/renderer/src/components/RightPane.vue`, `src/renderer/src/stores/layout.ts`, `tests/renderer/layout-clamp.test.ts`
- Modify: `src/renderer/src/App.vue`, `package.json`
- Test: `tests/renderer/layout-clamp.test.ts`

**Interfaces:**
- Consumes: workspace root
- Produces: `clampPanelWidth(px, min?, max?)`, layout store persisted under `layout:${workspaceRoot}`

- [ ] **Step 1: Install splitpanes**

```bash
npm install splitpanes
```

If types missing, add `src/renderer/src/shims-splitpanes.d.ts` with `declare module "splitpanes"`.

- [ ] **Step 2: Clamp helper test + implement**

```ts
export function clampPanelWidth(px: number, min = 180, max = 560): number {
  return Math.min(max, Math.max(min, px));
}
```

- [ ] **Step 3: Build SplitRoot UI**

Left SessionSidebar stub; center ChatPanel stub; right RightPane tab placeholders (Terminal / Preview / Browser).  
Persist widths to `localStorage`.

- [ ] **Step 4: Manual verify**

Open folder → drag separators; collapse left/right; center remains usable.

- [ ] **Step 5: Commit**

```bash
git add src tests package.json package-lock.json
git commit -m "feat: add resizable Agent Workspace three-column shell"
```

---

### Task 4: SessionBroker + AgentWorker isolation (stub runtime)

**Files:**
- Create: `src/main/session-broker.ts`, `src/main/agent-worker-host.ts`, `src/agent-worker/index.ts`, `src/agent-worker/runtime.ts`, `tests/main/session-broker.test.ts`
- Modify: `src/main/index.ts`, `electron.vite.config.ts`, `src/preload/index.ts`, `src/renderer/src/stores/sessions.ts`, `src/renderer/src/components/SessionSidebar.vue`

**Interfaces:**
- Consumes: `AgentCommand`, `AgentEvent`
- Produces: `createSessionBroker({ spawnWorker })`, `broker.createSession(cwd)`, `broker.send(sessionId, cmd)`, `broker.onEvent(cb)`
- Worker inbound: `{ kind: "command"|"shutdown"|"ping"; id?: string; command?: AgentCommand }`
- Worker outbound: `{ kind: "result"|"event"|"pong"|"fatal"; id?: string; data?: unknown; event?: Record<string, unknown>; error?: string }`

- [ ] **Step 1: Write broker routing test with fake worker**

```ts
it("routes command to the matching session worker only", async () => {
  const hits: string[] = [];
  const broker = createSessionBroker({
    spawnWorker: async (sessionId) => ({
      send: async (msg) => {
        if (msg.kind === "command") hits.push(sessionId);
        return null;
      },
      kill: () => {},
      onMessage: () => () => {},
    }),
  });
  const a = await broker.createSession("/tmp/a");
  const b = await broker.createSession("/tmp/a");
  await broker.send(a.id, { type: "ping" });
  expect(hits).toEqual([a.id]);
  expect(b.id).not.toEqual(a.id);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/main/session-broker.test.ts`

- [ ] **Step 3: Implement host + stub worker**

Stub: `ping` → ok; `prompt` → fake events + `prompt_done`; `hang` → busy-loop 30s for isolation smoke.  
Heartbeat every 5s; miss 3 → `stuck` + `worker_stuck`.  
`utilityProcess.fork` worker entry; register worker as electron-vite build input.

- [ ] **Step 4: Renderer New / Kill / Restart buttons + status dots**

- [ ] **Step 5: Isolation smoke (manual)**

Two sessions; `hang` on A; B still responds; UI remains responsive.

- [ ] **Step 6: Commit**

```bash
git add src tests electron.vite.config.ts
git commit -m "feat: add per-session agent workers and session broker"
```

---

### Task 5: Real Pi SDK worker + disk session list

**Files:**
- Create: `src/main/session-list.ts`, `tests/main/session-list.test.ts`
- Modify: `src/agent-worker/runtime.ts`, `src/agent-worker/index.ts`, `src/main/session-broker.ts`, `src/renderer/src/components/SessionSidebar.vue`, `package.json`

**Interfaces:**
- Consumes: `@earendil-works/pi-coding-agent` (`getAgentDir`, `SessionManager`, `createAgentSessionServices`, `createAgentSessionFromServices`)
- Produces: `listSessionsForCwd(cwd): Promise<SessionSummary[]>`; real command mapping in worker

- [ ] **Step 1: Install Pi packages**

```bash
npm install @earendil-works/pi-coding-agent@0.82.1 @earendil-works/pi-agent-core@0.82.1 @earendil-works/pi-ai@0.82.1
```

Install any required peers at the same version (e.g. `pi-tui`) if npm reports missing peers.

- [ ] **Step 2: Session list fixture test**

Temp dir with encoded cwd folder + jsonl header; assert only matching cwd returned.  
Implement encoding using SDK helpers if exported; otherwise port pi-web session path encoding into `session-list.ts`.

- [ ] **Step 3: Implement `runtime.ts` against SDK**

Open/create `SessionManager`; build services; create session; map `AgentCommand` to SDK methods; subscribe and forward events.  
For `prompt` with `citations`, prepend a fenced context block before `session.prompt(...)`.

- [ ] **Step 4: Wire sidebar list/create/open; block create without workspace**

- [ ] **Step 5: Manual verify**

New session writes jsonl under `~/.pi/agent/sessions/...`; two sessions both listed.

- [ ] **Step 6: Commit**

```bash
git add src tests package.json package-lock.json
git commit -m "feat: integrate Pi SDK workers and session file listing"
```

---

### Task 6: Chat UI streaming + composer

**Files:**
- Create: `src/renderer/src/components/MessageList.vue`, `src/renderer/src/components/Composer.vue`, `src/renderer/src/components/CitationCard.vue`, `src/renderer/src/stores/chat.ts`, `src/renderer/src/stores/composer.ts`, `tests/renderer/chat-reducer.test.ts`
- Modify: `src/renderer/src/components/ChatPanel.vue`, `src/preload/index.ts`

**Interfaces:**
- Consumes: `sessions:command`, `sessions:event`
- Produces: `reduceChatEvent(state, event)`, `sendPrompt`, `steer`, `followUp`, `abort`

- [ ] **Step 1: Chat reducer tests**

Cover: user append; assistant stream upsert; tool call upsert; `prompt_done`; `prompt_error`.

- [ ] **Step 2: Implement ChatPanel + Composer**

Cursor-like bubbles; collapsed tool calls; running indicator.  
Shortcuts: while running, Enter → steer, Alt+Enter → follow_up (tooltip).

- [ ] **Step 3: Manual verify**

Prompt streams or shows clear auth error; abort works.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "feat: add Cursor-like chat streaming and composer controls"
```

---

### Task 7: Model settings (pi-web parity subset)

**Files:**
- Create: `src/main/models-config.ts`, `src/renderer/src/components/ModelsSettings.vue`, `tests/main/models-config.test.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/components/TopBar.vue`, `src/renderer/src/components/Composer.vue`, `src/main/session-broker.ts`

**Interfaces:**
- Consumes: agent dir
- Produces: `readModelsConfig()`, `writeModelsConfig(next)`, `notifyWorkersReloadModels()`

- [ ] **Step 1: Serialized write test**

Overlapping writes leave valid JSON; last write wins.

- [ ] **Step 2: Settings panel + composer model switch**

Read/write `~/.pi/agent/models.json` via Main.  
API keys for common providers required.  
OAuth: wire SDK auth helpers if straightforward; otherwise ship API-key path complete in this task.  
Composer `set_model` affects **current session only**.  
After save, broker tells live workers to refresh models.

- [ ] **Step 3: Manual verify**

Save model; restart; selection works in chat.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "feat: add pi-web-like models settings against ~/.pi/agent"
```

---

### Task 8: Terminal tabs (node-pty + xterm)

**Files:**
- Create: `src/main/terminal-host.ts`, `src/renderer/src/components/TerminalTab.vue`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/components/RightPane.vue`, `package.json`

**Interfaces:**
- Consumes: workspace root
- Produces: `createTerminal()`, `write`, `resize`, `dispose`, `terminal:data` events

- [ ] **Step 1: Install and rebuild**

```bash
npm install node-pty xterm @xterm/addon-fit
npx electron-rebuild -f -w node-pty
```

- [ ] **Step 2: Implement host + UI**

Windows: `powershell.exe`; macOS: `process.env.SHELL || "/bin/zsh"`.  
cwd = workspace root. Multiple tabs supported.

- [ ] **Step 3: Manual verify**

Shell runs in workspace; second tab independent; dispose kills pty.

- [ ] **Step 4: Commit**

```bash
git add src package.json package-lock.json
git commit -m "feat: add workspace terminal tabs with node-pty and xterm"
```

---

### Task 9: File preview tab

**Files:**
- Create: `src/main/preview-host.ts`, `src/renderer/src/components/PreviewTab.vue`, `tests/main/preview-host.test.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/components/RightPane.vue`, `src/renderer/src/components/MessageList.vue`

**Interfaces:**
- Consumes: `resolveWorkspacePath`
- Produces: `readPreview(path): { kind: "text"|"markdown"|"image"|"unsupported"|"error"; ... }`

- [ ] **Step 1: preview-host tests + implementation**

Text/markdown utf-8 with 1.5MB cap; images data URL for png/jpeg/gif/webp; else unsupported; escape → error.

- [ ] **Step 2: PreviewTab + open-from-tool-path**

Open dialog defaulting to workspace; MessageList “Preview” on workspace paths.

- [ ] **Step 3: Manual verify**

Preview `.ts` / `.md` / `.png`; `../` denied.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "feat: add sandboxed file preview tab"
```

---

### Task 10: Browser tab + element select → citations

**Files:**
- Create: `src/main/browser-host.ts`, `src/main/select-element-script.ts`, `src/renderer/src/components/BrowserTab.vue`, `tests/shared/html-snippet.test.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/components/RightPane.vue`, `src/renderer/src/stores/composer.ts`, `src/agent-worker/runtime.ts`

**Interfaces:**
- Consumes: composer citations store
- Produces: `ElementCitation` on `browser:elementSelected`; `truncateHtmlSnippet(html, max = 4000)`

- [ ] **Step 1: Truncate helper test**

- [ ] **Step 2: BrowserHost with WebContentsView + bounds IPC**

Renderer reports `getBoundingClientRect`; Main `setBounds`.  
Navigate / back / forward / reload.

- [ ] **Step 3: Select mode**

Inject hover highlight + click capture (`selector`, `text`, `htmlSnippet`).  
CSP failure → toast `此页不支持选元素`.

- [ ] **Step 4: Citation chips → prompt citations → worker context block**

- [ ] **Step 5: Manual verify on https://example.com**

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: add in-app browser with element select to chat"
```

---

### Task 11: Hardening — stuck recovery, idle workers, acceptance pass

**Files:**
- Create: `README.md`
- Modify: `src/main/agent-worker-host.ts`, `src/main/session-broker.ts`, `src/renderer/src/components/SessionSidebar.vue`

**Interfaces:**
- Consumes: broker kill/restart
- Produces: idle destroy after 10 minutes; UI Terminate/Restart on stuck

- [ ] **Step 1: Idle timeout + stuck actions**

Keep session row after idle worker destroy; next message cold-starts worker.

- [ ] **Step 2: README**

Node/Electron versions, install, `npm run dev`, `electron-rebuild` for `node-pty`, `~/.pi/agent`, Win/mac only.

- [ ] **Step 3: Acceptance checklist (spec §Acceptance criteria 1–6)**

Fix blockers only.

- [ ] **Step 4: Commit**

```bash
git add src README.md
git commit -m "feat: harden worker lifecycle and document v1 acceptance"
```

---

## Spec coverage

| Spec requirement | Task |
|------------------|------|
| electron-vite Vue3 TS | 1 |
| Open Folder + recent | 2 |
| Three-column resizable Agent Workspace | 3 |
| Per-session utilityProcess + concurrency | 4–5 |
| `~/.pi/agent` sessions | 5 |
| Cursor-like chat + steer/follow-up | 6 |
| pi-web-like model settings | 7 |
| Terminal | 8 |
| File preview sandboxed | 9 |
| Browser element select → chat | 10 |
| Stuck isolation / recovery | 4, 11 |
| Win + mac | 8, 11 |
| Out of scope IDE/Linux | no tasks (intentional) |

## Self-review

- Channel names and `AgentCommand` / `ElementCitation` / `SessionSummary` stay consistent from Task 1 onward.
- No TBD placeholders; OAuth is explicitly optional relative to mandatory API-key path in Task 7.
- Every acceptance criterion maps to at least one task.
