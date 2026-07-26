# Task 3 Report: Three-column resizable Agent Workspace shell

**Branch:** `feat/agent-workspace-v1`  
**Date:** 2026-07-27

## Status

**Complete** — SplitRoot three-column shell with splitpanes, stub panels, layout Pinia store with `layout:${workspaceRoot}` persistence, clamp helper + tests.

## TDD

1. Added `tests/renderer/layout-clamp.test.ts` per brief (bounds, custom min/max).
2. Implemented `clampPanelWidth` in `src/renderer/src/stores/layout.ts`.
3. Vitest aliases `pinia` / `vue` to lightweight stubs so layout store can be imported without pulling broken devtools deps (`tests/mocks/*`, `vitest.config.ts`).

## What was built

| Area | Files |
|------|--------|
| Layout | `stores/layout.ts` — `clampPanelWidth`, `readLayout` / `writeLayout`, Pinia `useLayoutStore` |
| Shell | `SplitRoot.vue` — horizontal splitpanes, drag persist, collapse left/right with expand handles |
| Stubs | `SessionSidebar.vue`, `ChatPanel.vue`, `RightPane.vue` (Terminal / Preview / Browser tabs) |
| App | `App.vue` — `SplitRoot` when workspace root is set |
| Dependency | `splitpanes@^4.1.2` in `package.json` / lockfile; tarball install into `node_modules` (see concerns) |
| Tests | `tests/renderer/layout-clamp.test.ts` |

### Persistence

- Key: `layout:${workspaceRoot}` in `localStorage`.
- Fields: `leftWidth`, `rightWidth`, `leftCollapsed`, `rightCollapsed` (widths clamped 180–560 px on read/write).

### UI flow

- Open folder → `SplitRoot` replaces placeholder; widths load for that root.
- Drag separators → `@resized` converts pane % to px and saves.
- Collapse buttons on side panels; floating expand when collapsed; center chat pane keeps `min-size` 20%.

## Verification

| Command | Result |
|---------|--------|
| `npm test` | 8 passed (4 files) |
| `npm run typecheck` | **Failed** — broken `node_modules` (`vue-tsc` → missing `@vue/language-core`; `.ignored` vue) |
| `npm run build` | **Failed** — same corrupted vue / vite plugin chain |
| `npm run dev` | Not run (electron EBUSY / deps) |

## Commits

- `b660322` — `feat: add resizable Agent Workspace three-column shell`

## Concerns

1. **npm install EBUSY** on `node_modules/electron` — `splitpanes` installed via `npm pack` + manual extract; full `npm install` may be needed on a clean machine.
2. **node_modules health** — partial `.ignored` hoisting prevents typecheck/build until reinstall without electron lock.
3. **Vitest vue/pinia stubs** — global aliases; future renderer tests that need real Vue should narrow alias scope.

## Next (Task 4+)

- Real sessions list, chat, terminal/browser — stubs only in this task.

---

## Task 3 review fixes (2026-07-27)

| Finding | Fix |
|---------|-----|
| Garbled collapse/expand glyphs | Replaced with ASCII-safe HTML entities `&lsaquo;` / `&rsaquo;` in `SessionSidebar.vue`, `RightPane.vue`, `SplitRoot.vue` |
| Global Vitest `vue`/`pinia` aliases | Removed from `vitest.config.ts`; extracted pure helpers to `src/renderer/src/stores/layout-utils.ts`; `layout-clamp.test.ts` imports utils only |

### Verification (post-fix)

| Command | Result |
|---------|--------|
| `npm test -- tests/renderer/layout-clamp.test.ts` | 4 passed (1 file) |
| `npm test` | 8 passed (4 files) |
