# Browser Layout & Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Percent-based 20/30/50 layout (min 15 / max 70), prettier settings modal padding, resizable embedded DevTools + F12, browser history/bookmarks overlay (方案 1).

**Architecture:** Layout store persists pane percentages (`layout:v4`). Browser library (history + bookmarks) lives in `localStorage` helpers. `BrowserTab` hosts toolbar actions, DevTools splitpanes, and an overlay panel component.

**Tech Stack:** Vue 3, Pinia, splitpanes, Naive UI, Electron webview, TypeScript.

## Global Constraints

- Default panes: left 20% / chat 30% / right 50%; each min 15%, max 70%.
- History/bookmarks: `localStorage` only; overlay inside browser viewport (option A).
- F12 toggles embedded DevTools only.
- Replace Home with bookmark star; add History + Bookmarks list buttons.
- Respond / UI copy in 简体中文 where user-facing.

---

### Task 1: Percent layout store + SplitRoot

**Files:**
- Modify: `src/renderer/src/stores/layout-utils.ts`
- Modify: `src/renderer/src/stores/layout.ts`
- Modify: `src/renderer/src/components/SplitRoot.vue`
- Test: `tests/renderer/layout-utils.test.ts` (create if missing)

**Interfaces:**
- Produces: `PersistedLayout { leftSize, centerSize, rightSize, leftCollapsed, rightCollapsed, leftFilesSize }` percentages; `clampPanePercent(n)`; `DEFAULT_LAYOUT` 20/30/50; `layoutStorageKey` → `layout:v4:...`

- [ ] Update `layout-utils` to percent fields + clamps 15–70; migrate v3 px → defaults if no v4
- [ ] Update layout store setters to percent
- [ ] SplitRoot: bind three panes sizes from store; min 15 max 70; onResized persist percents
- [ ] Unit test clamp + default

---

### Task 2: Settings modal padding

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Modify: `ModelsSettings.vue`, `SkillsSettings.vue`, `ExtensionsSettings.vue`

- [ ] Add `.pi-settings-modal` styles (content padding 16–20px, footer gap)
- [ ] Apply class on each NModal

---

### Task 3: Browser library store (history + bookmarks)

**Files:**
- Create: `src/renderer/src/stores/browser-library.ts`
- Test: `tests/renderer/browser-library.test.ts`

**Interfaces:**
- `recordHistory({ url, title, favicon? })`, `removeHistory(id)`, `listHistory()`, `toggleBookmark(...)`, `isBookmarked(url)`, `removeBookmark(id)`, `listBookmarks()`, `filterEntries(entries, query)`, `groupHistoryByRecency(entries)`

- [ ] Implement localStorage helpers + tests

---

### Task 4: BrowserLibraryPanel + BrowserTab toolbar/overlay/devtools

**Files:**
- Create: `src/renderer/src/components/BrowserLibraryPanel.vue`
- Modify: `src/renderer/src/components/BrowserTab.vue`

- [ ] Panel UI: search, groups, hover delete, click navigate
- [ ] Remove Home; add star / history / bookmarks
- [ ] Record history on navigate; toggle bookmark
- [ ] DevTools via splitpanes; F12 toggle embedded only; persist width optional

---

## Self-review

- Spec coverage: layout, modals, DevTools, toolbar, overlay, localStorage — all tasked
- No placeholders
- Types consistent across tasks
