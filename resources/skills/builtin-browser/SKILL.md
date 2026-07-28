---
name: builtin-browser
description: >-
  Operate Pi Desktop's embedded right-pane browser via browser_* tools.
  Use ONLY when the user mentions the browser / 浏览器 / built-in browser,
  explicitly asks to use the embedded browser, or has selected page elements
  in that browser. Do NOT use for ordinary web fetching or research —
  prefer MCP servers and extension tools for normal network access.
---

# Built-in browser (Pi Desktop)

Pi Desktop embeds a browser in the right pane. Use `browser_*` tools on that
embedded browser (not external Chrome/Playwright).

## When to use

- User mentions 浏览器 / browser / 内置浏览器 / built-in browser
- User asks to open or automate the embedded right-pane browser
- User selected page elements (context includes "Context from browser selection")

## When NOT to use

- General "fetch this URL", search, docs, or API research → use MCP / extension tools
- Ordinary network access does not require the built-in browser

## Locators

Most element tools accept flexible locators (provide at least one):

- `css` / `selector`, `id`, `testId`
- `text` (visible text; `exact: true` for exact)
- `role` + optional `name` (accessible name)
- `placeholder`, `label`, `title`, `xpath`
- `nth` (0-based match index)

For typing/filling, put field content in `value`, and locate with `label` /
`placeholder` / `css` / `id` (not `text` unless you mean visible-text locator).

## Suggested flow

1. `browser_open_tab` (optional url) or `browser_tabs`
2. `browser_snapshot` / `browser_find` to discover elements
3. `browser_click` / `browser_fill` / `browser_select` / `browser_get_text`
4. `browser_wait_for` when the UI is async
5. `browser_close_tab` with `tabId` (from `browser_tabs`) — or omit `tabId` to close the visible tab

Prefer find/snapshot/get_* over `browser_evaluate`.
