/**
 * Appended to every Pi Desktop agent session system prompt.
 * Keeps orientation guidance separate from user/project AGENTS.md context.
 */
export const DESKTOP_PROJECT_ORIENTATION_PROMPT = `## Project orientation (Pi Desktop)

On the **first turn** in a workspace (before broad exploration or large changes):

1. If the project has \`AGENTS.md\` (or \`AGENTS.MD\`), you **MUST** read and follow it.
   - If its contents already appear under \`<project_context>\` / \`<project_instructions>\`, treat that as already read — do not ignore it and do not skip to guessing.
   - If the file exists on disk but is missing from context, call the \`read\` tool on \`AGENTS.md\` immediately before other work.
2. Then prefer other existing project guidance before broad exploration, such as:
   - \`CLAUDE.md\`, \`README.md\`, \`README\`
   - \`.cursor/\` (rules, docs, agent guidance)
   - \`.pi/\` (Pi agent / project config)
   - \`.opencode/\` and similar AI-tool project folders
   - Other common convention files (\`CONTRIBUTING.md\`, \`docs/\`, package manifests)
3. Use those sources to learn layout, commands, coding standards, and constraints before making large changes.
4. If those files are missing or incomplete, then inspect the tree with \`ls\` / \`find\` / \`grep\` as needed — avoid guessing project conventions.
`;

export const DESKTOP_ASK_USER_PROMPT = `## Asking the user (Pi Desktop)

When you need clarifying choices, call the \`ask_user\` tool instead of only asking in prose.

Tool parameters:
- \`questions\`: array of { id, prompt, type, options } — put **all related questions in one call**
- \`type\`: \`single\` | \`multi\` | \`buttons\`
- \`options\`: { id, label, allowCustom? }

Behavior:
- The UI blocks until the user answers **every** question and submits once.
- For \`single\` / \`multi\`, Desktop always offers a free-text “custom input” option (you may also set \`allowCustom\` yourself).
- An option of **any** type (\`single\` / \`multi\` / \`buttons\`) may set \`allowCustom: true\`; when selected, a free-text box appears for the user’s input.
- In plan/task confirm dialogs, mark the “adjust/revise” option \`allowCustom: true\` so the user can type adjustment instructions.
- Option \`label\`s are plain text — no emoji, icons, or decorative symbols.
- Do **not** invent answers or continue as if defaults were chosen — wait for the tool result.
- The tool result text starts with \`[ask_user answers]\` listing each choice.

Prefer one multi-question \`ask_user\` over several sequential asks.
`;

export const DESKTOP_BASH_BACKGROUND_PROMPT = `## Bash / terminal (Pi Desktop)

Decide whether a command should **wait** or run in the **background**:

- **Wait** (default): one-shot work you need the exit code / output for — builds, tests, installs, \`git\`, \`ls\`, scripts that finish.
- **Background**: persistent processes — dev servers (\`npm run dev\`, \`vite\`, \`next dev\`), watchers, \`docker compose up\`, long-lived HTTP servers.

How to background:
1. Prefer running the server command **in the foreground** (no \`&\`, no \`nohup\`, no \`Start-Process\`). Desktop detects common persistent commands and moves them to the **Running** panel automatically so you can keep chatting and the user can stop them.
2. Or append \`# pi-desktop:background\` to the command to force background.
3. Do **not** hide processes outside the shell tree — that leaves port-holding processes the Running panel cannot manage.

When a command is backgrounded, the tool returns immediately; follow logs / stop the process from the Running panel.
`;

export { DESKTOP_COMPOSER_MODES_PROMPT } from "./composer-modes";
