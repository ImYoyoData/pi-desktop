# Pi Desktop

Electron + Vue 3 Agent Workspace for the [Pi](https://pi.dev/) coding agent. v1 targets **Windows and macOS** only (Linux packages out of scope).

## Requirements

- **Node.js** 22.x (LTS recommended)
- **npm** 10+
- **Electron** 39.x (installed via devDependencies)
- Pi agent data under **`~/.pi/agent`** (sessions, `models.json`, auth). Override with `PI_CODING_AGENT_DIR` if needed.

## Install

```sh
npm install
```

Native modules (`node-pty`) must match the Electron ABI. After install or Electron upgrades:

```sh
npx electron-rebuild
```

If `postinstall` (`electron-builder install-app-deps`) fails, run `electron-rebuild` manually once `node_modules` is healthy.

## Develop

```sh
npm run dev
```

Other scripts: `npm test`, `npm run typecheck`, `npm run build`, `npm start` (preview build).

## Worker lifecycle

- One `utilityProcess` worker per open session.
- **Idle:** workers are destroyed after **10 minutes** with no activity; session rows stay in the sidebar (jsonl on disk). The next command **cold-starts** a worker.
- **Stuck:** missed heartbeats mark a session stuck; use **Terminate** or **Restart** in the session sidebar (other sessions keep running).

## v1 acceptance criteria

| # | Criterion | Verified here |
|---|-----------|---------------|
| 1 | electron-vite app on Windows/macOS | **Partial** — build/typecheck/unit tests; full app launch not verified in this environment (see below). |
| 2 | Cursor-style workspace + three-column layout | **Code complete** — manual UI pass deferred without Electron dev. |
| 3 | Multi-session concurrency; stuck session isolated | **Unit** — broker routing + idle/stuck/terminate tests; manual multi-session smoke deferred. |
| 4 | Streaming chat, steer/follow-up | **Code complete** — manual chat E2E deferred. |
| 5 | Model settings ↔ `~/.pi/agent` | **Unit + IPC** — manual settings panel E2E deferred. |
| 6 | Terminal, file preview, browser element-select | **Code complete** — manual right-pane E2E deferred (terminal needs rebuilt `node-pty`). |

## Known environment issues

- **Electron EBUSY / file locks on Windows** can block `npm install`, `npm run dev`, and launching the app in some CI or agent sandboxes. Unit tests (`npm test`) and `npm run typecheck` remain the reliable automated checks here.
- **`node-pty` native rebuild** is required before terminal tabs work; without `npx electron-rebuild`, pty creation fails at runtime even when the rest of the app builds.
- **Manual E2E** (Open Folder, concurrent sessions, Hang→stuck→Terminate, idle 10m destroy, browser on example.com) was **not run** in the Task 11 implementation environment because Electron could not be started reliably. Perform these on a local Win/mac machine after install + rebuild.
