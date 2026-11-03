/**
 * Appended to every Pi Desktop agent session system prompt.
 * Keeps guidance for desktop-provided tools separate from user/project AGENTS.md context.
 */
import { ASK_USER_RULES } from "./ask-user";

export const DESKTOP_ASK_USER_PROMPT = `## Asking the user (Pi Desktop)

When you need clarifying choices, call the \`ask_user\` tool instead of only asking in prose.

${ASK_USER_RULES.map((rule) => "- " + rule).join("\n")}
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
