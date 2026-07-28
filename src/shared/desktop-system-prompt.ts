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

export { DESKTOP_COMPOSER_MODES_PROMPT } from "./composer-modes";
