# Pi Desktop — Design Spec

**Date:** 2026-07-27  
**Status:** Approved for planning  
**Product:** Desktop Agent Workspace for [Pi](https://pi.dev/) coding agent

## Goal

Build a Cursor-like **Agent Workspace** desktop app (not IDE mode) that drives Pi with multi-session concurrency, resizable panels, terminal, file preview, and an in-app browser with element-selection-to-chat.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Shell | Electron + Vue3 + TypeScript via **electron-vite** |
| Agent runtime | Pi SDK in isolated **per-session utilityProcess** workers |
| Data directory | Reuse `~/.pi/agent` (same as pi CLI / pi-web) |
| Platforms (v1) | Windows + macOS |
| Layout | Left sessions · Center chat · Right tab panes |
| Workspace | Cursor-style Open Folder; window bound to one folder |
| Model settings UX | Align with pi-web (read/write `models.json`, auth) |
| Chat UX | Align with Cursor Agent (streaming, tools, steer/follow-up) |
| Right pane (v1) | Terminal + file preview + browser element picker |
| Right pane scope | Shared globally across sessions (not per-session) |

## Architecture

### Process model

```text
Renderer (Vue3)
  Left: session list | Center: chat | Right: terminal / preview / browser
         │ IPC
Main Process
  Window, workspace, SessionBroker, pty host, BrowserView, safe file reads
         │ one utilityProcess per session
AgentWorker × N
  Pi SDK AgentSession; reads ~/.pi/agent
```

**Rules**

1. One AgentWorker per chat session; create on open/new, destroy on close or idle timeout.
2. Main `SessionBroker` routes `{ sessionId, type, payload }` commands and fans out events to the renderer.
3. Multiple workers may run prompts/tools concurrently.
4. Stuck/crashed worker can be killed and restarted without taking down the app or other sessions.
5. Writes to shared config (`models.json`, etc.) are serialized in Main; workers reload afterward.
6. Terminal pty, embedded browser, and native dialogs live in Main — not in workers.

### Why not in-process SDK in Main

A single Node event loop shared by UI orchestration and all agents would let one blocked session freeze the window and sibling agents. Per-session `utilityProcess` isolation is required for the multi-agent requirement.

## UI layout

### Top bar

- Current workspace path
- Open Folder
- Entry to model/settings
- Standard window controls

### Left — sessions

- Sessions for the **current workspace** only (cwd-scoped), grouped like pi-web history
- Status: idle / running / error / stuck
- New / rename / delete; switch updates center chat only

### Center — chat

- Cursor-style messages, collapsible tool calls, streaming
- Steer (interrupt-style) and follow-up while running (Pi semantics)
- Composer: model picker, thinking level, tool preset, send
- Element-selection references appear as attachable citation cards before send

### Right — tab workspace

- Resizable column; internal horizontal/vertical splits supported
- Tab types: Terminal, File Preview, Browser
- Layout widths and splits persisted per workspace key
- Shared across session switches in v1

### Panel resizing

- Three columns with drag separators; widths persisted per workspace
- Left/right collapsible; center chat always usable

### Workspace (Cursor-like)

- Welcome: recent projects + Open Folder
- Window binds to one folder; new sessions default to that cwd
- Without a workspace, block new agents and prompt to open a folder

## Data & Agent flow

### Paths under `~/.pi/agent`

| Path | Role |
|------|------|
| `sessions/<encoded-cwd>/*.jsonl` | Tree-structured session history |
| `models.json` | Custom models / providers |
| skills, auth, other Pi config | Loaded by Pi SDK as in CLI |

Optional override via `PI_CODING_AGENT_DIR` (advanced; no complex UI in v1).

### Lifecycle

1. Open workspace → Main lists sessions for that cwd → left sidebar.
2. New session → allocate id → spawn AgentWorker → `SessionManager.create(cwd)`.
3. Open existing → worker `SessionManager.open(file)`.
4. Commands (aligned with pi-web RPC set): `prompt`, `steer`, `follow_up`, `abort`, `set_model`, `compact`, …
5. Worker events stream to Main → renderer for that session.
6. Idle timeout may destroy worker; jsonl remains on disk; reopen cold-starts worker.

### Model settings

- Panel: model list, defaults, thinking levels, API key / OAuth (pi-web parity)
- Main serializes writes to `models.json`, then notifies workers to refresh
- Per-chat model switch calls `set_model` on that session only

### Cross-pane collaboration

- **Preview:** open paths from tool results or explicit open; Main enforces workspace-root sandbox
- **Browser select:** Main delivers `{ url, selector, htmlSnippet, text }` to composer citations; user confirms then `prompt`
- **Terminal:** user pty separate from Pi SDK bash tool inside the worker

## Right-pane technical notes

### Terminal

- `node-pty` in Main + `xterm.js` in renderer over IPC
- Default cwd = workspace; multiple terminal tabs
- Windows: PowerShell; macOS: `$SHELL`
- Not shared with agent bash

### File preview

- Read-only in v1: text/code highlight, Markdown, images
- Other types: open externally or show binary stub
- No full IDE editor or multi-file diff editor in v1

### Browser + element select

- `WebContentsView` / BrowserView hosted in right tab; Vue owns address bar
- Navigate, back/forward/reload; http(s) primary
- Select mode: inject content script → hover highlight → click → capture selector, visible text, size-capped outerHTML → citation in composer
- CSP/injection failures → toast that the page cannot be inspected
- Do not treat the browser as a full Chrome replacement (no extension ecosystem in v1)

## Error handling

| Scenario | Behavior |
|----------|----------|
| Worker crash / heartbeat timeout | Mark session stuck; terminate or restart that worker only |
| Auth / model failure | In-chat error + affordance to open model settings |
| New session without workspace | Block + Open Folder |
| Path escape on preview | Deny + message |
| Element inject failure | Toast |
| Pty start failure | Error inside tab; allow reopen |
| Missing `~/.pi/agent` | SDK default init; settings prompt to configure |

## Out of scope (v1)

- Full IDE edit / debug
- Cloud account sync / multi-window collaboration complexity
- Browser extension ecosystem
- Linux packages
- Per-session right-pane state (deferred)

## Acceptance criteria (v1)

1. electron-vite app runs on Windows and macOS.
2. Cursor-style workspace open; three-column Agent Workspace with drag resize.
3. Multiple sessions run agents concurrently; killing/stalling one does not freeze others or the shell.
4. Streaming chat + tool UI; steer/follow-up basically usable.
5. Model settings read/write `~/.pi/agent` with pi-web-like capability.
6. Right pane: terminal, file preview, browser element-select into current chat.

## Suggested repo shape (for planning)

```text
pi-desktop/
  docs/superpowers/specs/     # this document
  electron/ or src/
    main/                     # Main + SessionBroker + pty + browser host
    preload/
    renderer/                 # Vue3 Agent Workspace UI
    agent-worker/             # Pi SDK worker entry
```

Exact folder naming left to the implementation plan.
