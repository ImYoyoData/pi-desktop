# Changes Tab + 轻量 Git — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Changes tab as Pi-web-style change review + light Git ops; remove browser 「⋯」 menu.

**Architecture:** Extend main-process `git-host` (pi-web-compatible status/diff) with branch/commit/pull/push/merge IPC; render master/detail Changes UI; keep commit as checkbox → auto-stage → commit.

**Tech stack:** Electron main `execFile(git)`, existing IPC/preload patterns, Vue3 + Naive UI, existing `t` i18n.

**Spec:** `docs/superpowers/specs/2026-07-27-changes-git-design.md`

---

## File map

| File | Role |
|------|------|
| `src/main/git-host.ts` | All git CLI helpers |
| `src/main/git-ipc.ts` | IPC handlers |
| `src/shared/protocol.ts` | `IpcChannels.git.*` |
| `src/preload/index.ts` | `window.api.git.*` |
| `src/renderer/src/env.d.ts` | API typings if needed |
| `src/renderer/src/components/ChangesTab.vue` | Full UI |
| `src/renderer/src/components/BrowserTab.vue` | Remove more menu |
| `src/renderer/src/i18n/zh-CN.ts` / `en.ts` | Copy |
| `tests/...` | Unit tests for porcelain/diff helpers if extracted |

---

### Task 1: Remove browser 「⋯」

**Files:** `BrowserTab.vue`

- Delete `moreOptions`, `onMoreSelect`, Ellipsis dropdown and unused imports.
- Verify DevTools + openExternal buttons remain.

**Verify:** Toolbar has no ellipsis control.

---

### Task 2: Extend git-host (status branch + diff + ops)

**Files:** `src/main/git-host.ts`, optional `tests/main/git-host.test.ts`

- Add `branch` to status via `rev-parse --abbrev-ref HEAD`.
- Port `getGitFileDiff` from pi-web (`_pi-web-ref/lib/git-changes.ts`) adapted to relative paths + workspace root.
- Add: `listBranches`, `checkout`, `createBranch`, `mergeBranch`, `commitPaths`, `pull`, `push`.
- Normalize errors to `{ ok: false, message }` style for IPC.

**Verify:** Vitest for porcelain/classify if pure functions; manual git repo smoke later.

---

### Task 3: IPC + preload + protocol

**Files:** `protocol.ts`, `git-ipc.ts`, `preload/index.ts`, `env.d.ts`

Wire channels:

- `git:status` (enriched)
- `git:diff`
- `git:branches`
- `git:checkout` / `git:createBranch` / `git:merge`
- `git:commit`
- `git:pull` / `git:push`

**Verify:** `npm run typecheck`

---

### Task 4: ChangesTab UI

**Files:** `ChangesTab.vue`, i18n

- Header: branch dropdown (switch / create / merge dialogs), pull, push, refresh.
- Commit row: textarea + Commit button; checkboxes on file list (default all).
- Split: file list | DiffView (render unified patch simply: +/-/context lines).
- Listen `pi-fs-changed` + onMounted/onActivated refresh.
- Toasts for success/errors via `useMessage`.

**Verify:** Open Changes in a git workspace; list + diff + commit dry-run.

---

### Task 5: Acceptance pass

- Non-git empty state
- typecheck
- Browser toolbar check
- Quick manual: checkout create, pull/push may fail without remote (toast OK)

---

## Execution note

Implement tasks in order 1→5. Do not commit unless user asks.
