# Changes Tab + 轻量 Git（方案 B）

**Date:** 2026-07-27  
**Status:** Approved (user confirmed)  
**Product context:** Pi Desktop 是本机 Pi 的桌面壳（内置 Pi SDK，复用 `~/.pi/agent`）。Changes 对齐 [agegr/pi-web](https://github.com/agegr/pi-web) 的「变更审阅」，并增加桌面端需要的轻量 Git 操作。不是 Cursor IDE Source Control。

## Goals

1. **审阅 Pi 改动**：当前分支、变更文件列表、相对 HEAD 的文件 diff（移植 pi-web `getGitStatus` / `getGitFileDiff` 语义）。
2. **轻量 Git**：提交（勾选直提）、拉取、推送、切换/新建分支、合并到当前分支。
3. **浏览器清理**：移除工具栏「⋯」菜单（开发者工具 / 系统浏览器已有独立按钮）。

## Non-goals (this slice)

- Cursor 式 Staged / Unstaged 双栏
- Git worktree 多目录切换（pi-web 有，本版不做）
- 冲突可视化解决器（仅标记 `C`，操作失败 toast）
- 远程分支完整浏览 / PR / stash UI

## UI layout (Changes tab)

```text
┌─────────────────────────────────────────┐
│ <branch> ▾   ↓ Pull  ↑ Push   ↻ Refresh │
├─────────────────────────────────────────┤
│ [commit message…………]          [Commit] │
├──────────────────┬──────────────────────┤
│ Changed files    │  Diff pane           │
│ ☑ path  M        │  (unified patch)     │
│ ☐ path  A        │                      │
└──────────────────┴──────────────────────┘
```

- Default: all changed files checked.
- Click row → load diff for that file in the right pane.
- Empty / non-git → empty state copy.

## Behaviors

| Action | Implementation notes |
|--------|----------------------|
| Status | Extend existing `git:status`; include `branch`, `upstream`/`ahead`/`behind` if cheap |
| Diff | New `git:diff` — port pi-web `getGitFileDiff` (HEAD / untracked synthetic patch) |
| Branch list | `git branch --list` (+ optional remote names later) |
| Checkout | `git checkout <branch>` |
| Create branch | `git checkout -b <name>` from HEAD |
| Merge | `git merge <branch>` into current; on conflict return error + refresh status |
| Commit | `git add -- <paths>` then `git commit -m`; require non-empty message + ≥1 checked file |
| Pull | Prefer `git pull --rebase`; on failure surface stderr (optional fallback plain pull) |
| Push | `git push` (current upstream); if no upstream, toast to set upstream / push `-u` once |
| Refresh | Manual button + on Changes tab visible + on `pi-fs-changed` for workspace |

## IPC / main process

Extend `src/main/git-host.ts` + `git-ipc.ts` + `IpcChannels.git` + preload:

- `status` → add `branch: string | null`, keep `files[]`
- `diff(relativePath)` → `{ supported, status?, patch? }`
- `branches()` → `{ current, local: string[] }`
- `checkout(branch)` / `createBranch(name)` / `merge(branch)`
- `commit({ message, paths })`
- `pull()` / `push()`

All run with `git -C <workspaceRoot>`, timeout + maxBuffer like today. Never allow paths outside workspace/repo root.

## Browser

In `BrowserTab.vue`: remove `moreOptions` / `NDropdown` / `EllipsisHorizontalOutline` / `onMoreSelect`. Keep dedicated DevTools and Open External buttons.

## i18n

Add `t.*` strings for Changes chrome (branch, pull, push, commit, merge, empty states, errors) in `zh-CN` + `en`.

## Acceptance

1. Git repo workspace: Changes shows branch + file list; click shows patch.
2. Commit checked files with message updates status.
3. Pull / push / checkout / create branch / merge work or show clear error toast.
4. Non-git workspace: empty state, no crash.
5. Browser toolbar has no 「⋯」 menu; DevTools + external still work.
6. UI language follows system locale (existing `t` / Monaco rules unchanged).
