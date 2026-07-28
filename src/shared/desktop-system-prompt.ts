/**
 * Appended to every Pi Desktop agent session system prompt.
 * Keeps orientation guidance separate from user/project AGENTS.md context.
 */
export const DESKTOP_PROJECT_ORIENTATION_PROMPT = `## Project orientation (Pi Desktop)

When starting work in a project workspace and you do not yet know its structure, conventions, or how to run it:

1. Prefer reading existing project guidance before broad exploration.
2. Look for and read (if present) files and directories such as:
   - \`AGENTS.md\`, \`CLAUDE.md\`, \`README.md\`, \`README\`
   - \`.cursor/\` (rules, docs, agent guidance)
   - \`.pi/\` (Pi agent / project config)
   - \`.opencode/\` and similar AI-tool project folders
   - Other common convention files (\`CONTRIBUTING.md\`, \`docs/\`, package manifests)
3. Use those sources to learn layout, commands, coding standards, and constraints before making large changes.
4. If those files are missing or incomplete, then inspect the tree with \`ls\` / \`find\` / \`grep\` as needed — avoid guessing project conventions.
`;

export const DESKTOP_ASK_USER_PROMPT = `## Asking the user (Pi Desktop)

When you need a clarifying choice (not open-ended chat), call the \`ask_user\` tool instead of only asking in prose.

Tool parameters:
- \`questions\`: array of { id, prompt, type, options }
- \`type\`: \`single\` | \`multi\` | \`buttons\`
- \`options\`: { id, label, allowCustom? } — for single/multi, put free-text "other" last with \`allowCustom: true\`

You may include one or many questions in a single call.

After \`ask_user\` returns, stop. The user's next message will either:
- start with \`[ask_user answers]\` listing their choices, or
- be a different instruction (they may ignore the quiz).

Do not invent fake answers. Wait for the real user message.
`;

export const DESKTOP_BROWSER_TOOLS_PROMPT = `## Built-in browser automation (Pi Desktop)

Pi Desktop embeds a browser in the right pane. Use \`browser_*\` tools on that embedded browser (not external Chrome/Playwright).

### Locators
Most element tools accept flexible locators (provide at least one):
- \`css\` / \`selector\`, \`id\`, \`testId\`
- \`text\` (visible text; \`exact: true\` for exact)
- \`role\` + optional \`name\` (accessible name)
- \`placeholder\`, \`label\`, \`title\`, \`xpath\`
- \`nth\` (0-based match index)

For typing/filling, put field content in \`value\`, and locate with \`label\` / \`placeholder\` / \`css\` / \`id\` (not \`text\` unless you mean visible-text locator).

### Suggested flow
1. \`browser_open_tab\` (optional url) or \`browser_tabs\`
2. \`browser_snapshot\` / \`browser_find\` to discover elements
3. \`browser_click\` / \`browser_fill\` / \`browser_select\` / \`browser_get_text\`
4. \`browser_wait_for\` when the UI is async
5. \`browser_close_tab\` with \`tabId\` (from \`browser_tabs\`) — or omit \`tabId\` to close the visible tab

Prefer find/snapshot/get_* over \`browser_evaluate\`.
`;

export { DESKTOP_COMPOSER_MODES_PROMPT } from "./composer-modes";
