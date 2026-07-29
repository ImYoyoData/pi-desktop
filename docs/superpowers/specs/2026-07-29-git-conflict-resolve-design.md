# Git 冲突可视化解决（按块选择）

**Date:** 2026-07-29  
**Status:** Approved in chat (user chose approach A; confirmed recommended UI)  
**Supersedes:** Non-goal in `2026-07-27-changes-git-design.md` —「冲突可视化解决器」对本切片取消。

## Goals

1. 在 Changes 右侧对冲突文件（`status === "conflict"` / `code === "C"`）提供专用解决 UI。
2. 解析工作区中的 Git 冲突标记，**按块**选择「当前分支（Ours）」或「传入变更（Theirs）」。
3. 全部块选定后，用户点「确认解决」→ 写入无标记内容 → `git add` → 刷新状态。
4. 支持整文件快捷「全部用当前 / 全部用传入」，以及「放弃合并」。

## Non-goals

- 三方（base / `:1`）可视化对比
- 按块「两者都要」以外的任意行级手改合并编辑器（确认前可只读预览；不做完整 Monaco 自由编辑 MVP）
- Rebase 专用 continue/skip 流（`abort` 需能识别 merge 与 rebase 并调用对应 abort）
- 二进制 / 无文本冲突标记的文件（提示无法在此解决，仍可用整文件 checkout ours/theirs）
- PR / stash / worktree

## UX

```text
┌─ Conflict banner ─────────────────────────────────────────┐
│ N 个冲突文件。解决后勾选并 Commit。  [放弃合并]            │
├─ commit row (unchanged) ──────────────────────────────────┤
├─ file list ─┬─ Conflict resolve pane ─────────────────────┤
│  … C file   │  [全部用当前] [全部用传入]                   │
│             │  块 1/3  [采用当前] [采用传入]               │
│             │  ┌─ merged preview (scroll) ──────────────┐ │
│             │  │  common lines…                         │ │
│             │  │  ▓ conflict block (choice highlight)   │ │
│             │  │  …                                     │ │
│             │  └────────────────────────────────────────┘ │
│             │  [确认解决]（未选完禁用）                     │
└─────────────┴─────────────────────────────────────────────┘
```

### Behaviors

| 项 | 行为 |
|----|------|
| 入口 | 选中冲突文件 → 右侧走冲突面板，不走普通 `ChangesDiffEditor` |
| 解析 | 读工作区文件文本，解析 `<<<<<<<` / `=======` / `>>>>>>>`（含可选 `\|` 第三段 marker 时忽略 base 段，仍按 ours/theirs 两段） |
| 按块选择 | 每块独立 `ours` \| `theirs` \| `unset`；高亮当前块；可「上一块 / 下一块」 |
| 预览 | 根据已选块即时拼出合并预览；未选块显示占位或保留两侧摘要 |
| 确认 | 全部块非 `unset` → 启用确认 → `resolveConflict({ path, content })` |
| 整文件快捷 | `checkout --ours\|--theirs` + `git add`，或等价：全部块设为同一侧后走同一 resolve 路径 |
| 放弃合并 | `abortMerge()`：若处于 rebase 则 `rebase --abort`，否则 `merge --abort` |
| 无标记冲突 | 仍可用「全部用当前 / 全部用传入」（stage 侧 checkout）；预览提示「无文本冲突标记」 |
| i18n | zh-CN + en |

### Labels

- **当前 / Ours**：合并时的 `HEAD`（`:2`）
- **传入 / Theirs**：正在并入的一方（`:3`）；标题尽量显示分支短名（`MERGE_HEAD` / rebase 头），失败则用「传入变更」

## Backend (main)

Extend `git-host.ts` + `git-ipc` + `protocol` + preload:

1. **`conflictContent(relativePath)`**  
   - 返回 `{ ours, theirs, working, labels?: { ours, theirs } }`  
   - `ours` / `theirs` 来自 `git show :2:path` / `:3:path`（失败则为空字符串并注明）  
   - `working` 为工作区文件 UTF-8 文本（过大则 `supported: false`）

2. **`resolveConflict({ relativePath, content })`**  
   - 路径沙箱同现有 git/preview  
   - 写盘 → `git add -- path`  
   - 成功后 status 中该路径不再为 conflict

3. **`checkoutConflictSide(relativePath, "ours" \| "theirs")`**  
   - `git checkout --ours\|--theirs -- path` + `git add -- path`

4. **`abortMerge()`**  
   - 检测 `.git/rebase-merge` / `rebase-apply` → `rebase --abort`，否则 `merge --abort`

Timeouts / `gitAllowFail` / 错误码沿用现有 `GitOpResult`（`conflicts`、`invalid_args`、`not_repo` 等）。

## Frontend

- 新组件：`ChangesConflictResolve.vue`（或同等命名）  
  - props：`filePath`、`working`、`ours`、`theirs`、labels  
  - emit / callback：`resolved` → 父级 `refresh`  
- `conflict-markers.ts`：纯函数解析与按选择拼接  
- `ChangesTab.vue`：`code === "C"` 时 `loadConflict`；横幅加 Abort  
- 预览可用只读 Monaco 单栏或轻量 `<pre>` + 块装饰；**不必** side-by-side DiffEditor 作为 MVP 主交互（对照 ours/theirs 可用折叠区或次要只读双栏，可选）

## Tests

- 单元：`conflict-markers` 解析多块、拼接 ours/theirs、畸形标记容错  
- dugite：造 merge 冲突 → `conflictContent` 有两侧 → `resolveConflict` 后 porcelain 无 `U`  
- `checkoutConflictSide` / `abortMerge` 各至少一条冒烟

## Acceptance

1. 有文本标记的冲突文件：可按块选左右，确认后文件无标记且已 stage，列表更新。  
2. 「全部用当前 / 传入」可一键解决该文件。  
3. 未选完不能确认。  
4. 「放弃合并」清除合并/变基冲突状态（或清晰报错）。  
5. 普通非冲突文件仍走现有 diff / 还原流程，行为不变。

## Out of scope follow-ups

- 按块「两者都要」  
- 确认前可编辑合并结果  
- Rebase `--continue` 按钮（解决完后用户仍用 Commit / 终端）
