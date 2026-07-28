# Turn file revert — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** After each agent turn, offer 撤回 to restore workspace files to pre-prompt state (chat unchanged).

**Architecture:** Main holds in-memory checkpoints; fs-watch feeds path touches while capturing; renderer begins on sendPrompt, finishes on idle, shows button on user bubbles.

**Tech Stack:** Electron IPC, existing fs-watch, Pinia chat, MessageList Vue.

## Global Constraints

- Files only; no chat truncate
- Skip binary / >2MiB
- In-memory v1
- Same ignore dirs as fs-watch

---

### Task 1: Checkpoint core + unit tests

**Files:** `src/main/checkpoint-host.ts`, `tests/main/checkpoint-host.test.ts`

- [x] Pure helpers: record first touch (previous text | missing | skipped)
- [x] begin / finish / revert / getSummary
- [x] Tests for add/change/unlink merge and revert writes (temp dir)

### Task 2: IPC + fs-watch hook

**Files:** `src/main/fs-watch-host.ts`, `src/main/checkpoint-ipc.ts`, `src/main/index.ts`, `src/shared/protocol.ts`, `src/preload/index.ts`

- [x] `addFsChangeListener` from fs-watch flush
- [x] Register IPC begin/finish/get/revert
- [x] Expose `api.checkpoint.*`

### Task 3: Renderer wiring + UI

**Files:** `src/renderer/src/stores/chat.ts`, `Composer.vue` (if needed), `stores/checkpoint.ts`, `MessageList.vue`, i18n

- [x] begin after user message id known; finish on prompt_done / idle
- [x] 撤回 button + confirm + toast

### Task 4: Verify

- [x] `npm test` + `npm run typecheck`
