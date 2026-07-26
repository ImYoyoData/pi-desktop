# Browser Layout & Polish Design

**Date:** 2026-07-27  
**Status:** Approved approach (方案 1) — awaiting user review of this spec  
**Scope:** Three-pane layout ratios, settings modal padding, embedded DevTools resize + F12, browser history/bookmarks overlay

## Goals

1. Default split: left **20%** / chat **30%** / right **50%**; each pane min **15%**, max **70%**.
2. Beautify inner padding of settings modals (Models / Skills / Extensions, and similar).
3. Browser embedded DevTools: horizontally resizable; **F12** toggles the **embedded** pane only (never a detached external DevTools window).
4. Replace toolbar **Home** with a **bookmark (star)** toggle for the current page.
5. Add **History** and **Bookmarks list** toolbar buttons that open an in-browser overlay panel (option A), matching the reference UI (search + grouped list + hover delete).

## Non-goals

- Persisting browser history/bookmarks to disk under `~/.pi` (use `localStorage` only).
- New RightPane tabs for history/bookmarks.
- Changing session/chat history behavior.
- Full Chrome-parity (sync, folders, import/export).

## Layout

### Behavior

| | Left | Chat | Right |
|---|------|------|-------|
| Default | 20% | 30% | 50% |
| Min | 15% | 15% | 15% |
| Max | 70% | 70% | 70% |

- Persist **percentages** (not px) under a new key `layout:v4:<workspaceRoot>`.
- On first load with no v4 data: use defaults above.
- Migrate from `layout:v3` / `v2` when present: convert stored px widths to % using current container width when available; if container width unknown at read time, fall back to defaults (or approximate from last known window if already stored — prefer defaults to avoid bad ratios).
- Collapse rails unchanged.

### Files

- `src/renderer/src/stores/layout-utils.ts` — `DEFAULT_LAYOUT` as percents; clamp helpers; storage key v4.
- `src/renderer/src/stores/layout.ts` — store fields as percents; setters clamp 15–70.
- `src/renderer/src/components/SplitRoot.vue` — Pane `:size` / `:min-size` / `:max-size` from store percents.

## Settings modal padding

### Behavior

Unify card modal content spacing so body is not flush against edges:

- Content padding ≈ `16–20px` horizontal/vertical (or Naive card content slot override).
- Consistent gap between header and body; footer with comfortable top padding.
- Apply to: `ModelsSettings.vue`, `SkillsSettings.vue`, `ExtensionsSettings.vue` (and any sibling settings modals with the same cramped pattern). Prefer a small shared class in `main.css` (e.g. `.pi-settings-modal`) over per-file one-offs when practical.

## Embedded DevTools

### Behavior

- When open: horizontal split between page webview and DevTools webview.
- Splitter is **draggable**; remember width % in component state (optional: `localStorage` key `browser:devtoolsWidth`).
- Default DevTools share ≈ **40%** of the browser viewport width; min ≈ **220px** (as % of browser tab width).
- F12 (when browser tab visible) and toolbar DevTools button call the same `toggleDevTools` path: show/hide pane + `browser.attachDevTools` / close.
- Must **not** open Electron’s external/detached DevTools window as the primary UX (existing `setDevToolsWebContents` + detach mode for embedding stays; do not call fallback `openDevTools` without a dock target).

### Files

- `src/renderer/src/components/BrowserTab.vue` — replace fixed CSS grid with `splitpanes` (or equivalent drag handle) for page | DevTools.

## Browser toolbar & overlays

### Toolbar

- Remove Home button and `goHome` / Baidu-as-home navigation trigger from toolbar (initial `src` may still use a default URL).
- Add **star** button: toggles bookmark for current URL; filled when bookmarked.
- Add **History** and **Bookmarks** list buttons (right side of toolbar, near existing actions). Clicking the active button closes the overlay; switching between History and Bookmarks swaps the panel mode.

### Overlay (option A)

Full-area panel over the browser viewport (below toolbar):

- Search input (filter by title/url).
- Grouped list:
  - History: **Today** / **Last 7 days** / **Older** (collapsible sections).
  - Bookmarks: flat list (or simple “All”); searchable.
- Row: favicon (or globe fallback), title or URL, hover trash to delete.
- Click row → navigate webview to that URL and close overlay.

### Data (`localStorage`)

- History entry: `{ id, url, title, favicon?, visitedAt }`. Cap length (e.g. 200); dedupe by URL on navigate (move to top / update timestamp).
- Bookmark: `{ id, url, title, favicon?, createdAt }`. Unique by URL.
- Record history on successful navigation (`did-navigate` / stop-loading with real URL).

### Files

- New: `src/renderer/src/stores/browser-library.ts` (or `utils/browser-library.ts`) — read/write/search helpers.
- `BrowserTab.vue` — toolbar + overlay UI; optional small child `BrowserLibraryPanel.vue` if the template grows large.

## Testing / verification

- Manual: drag three panes to mins/maxes; remount workspace uses defaults when no v4.
- Manual: F12 open/close embedded DevTools; drag splitter; no external window.
- Manual: star current page; open bookmarks list; open history after several navigations; search + delete; click to navigate.
- Visual: settings modals have even padding, no content flush to card edge.

## Spec self-review

- [x] No unresolved placeholders
- [x] Layout percents consistent with user request
- [x] Overlay location matches approved option A
- [x] Non-goals keep scope to 方案 1
- [x] File touch list is concrete
