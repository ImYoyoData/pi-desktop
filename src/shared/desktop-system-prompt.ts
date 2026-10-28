/**
 * Appended to every Pi Desktop agent session system prompt.
 * Keeps guidance for desktop-provided tools separate from user/project AGENTS.md context.
 */
export const DESKTOP_ASK_USER_PROMPT = `## Asking the user (Pi Desktop)

When you need clarifying choices, call the \`ask_user\` tool instead of only asking in prose.

Tool parameters:
- \`questions\`: array of { id, title?, prompt, type, skippable?, options } — put **all related questions in one call**
- \`title\`: short tab label, at most 4 characters, e.g. \`目标\`, \`范围\` — users pick questions by this tab; the card truncates longer titles
- \`prompt\`: the full question, shown as the card heading
- \`type\`: \`single\` | \`multi\` | \`buttons\`
- \`skippable\`: optional; omitted means the user may skip this question. Set \`false\` only for hard requirements (e.g. confirm/reject gates).
- \`options\`: { id, label, description?, allowCustom? }
- \`description\`: optional one-line note under the label (what picking this option implies)

Behavior:
- The UI blocks until the user answers and submits once.
- **Users can and often will skip questions** — questions default to skippable. Expect skipped answers and never re-ask them on your own.
- The card always shows a free-text answer box, so the user can answer without picking an option; a typed answer is formatted as \`custom: …\`.
- Every question always gets an extra “custom input” option, even when one of your options already sets \`allowCustom\`; that row requires text.
- In plan/task confirm dialogs, mark the “adjust/revise” option \`allowCustom: true\` so the user can type adjustment instructions. Keep those gates \`skippable: false\` when confirmation is mandatory.
- Users may paste screenshots into the card; attached images arrive as image content next to the text.
- Option \`label\`s are plain text — no emoji, icons, or decorative symbols.
- Do **not** invent answers or continue as if defaults were chosen — wait for the tool result.
- The tool result text starts with \`[ask_user answers]\` and lists every question; skipped ones are marked \`→ [skipped]\`. Proceed with what you have or state what is missing.

Prefer one multi-question \`ask_user\` over several sequential asks.
`;

export const DESKTOP_TODO_PROMPT = `## Todo checklist (Pi Desktop)

For any multi-step task, maintain the user-visible checklist with the \`todo_write\` tool.

Rules:
1. **Plan first** — before starting work, send the complete list of steps (status \`pending\`).
2. **One in progress** — flip an item to \`in_progress\` before starting it, and to \`completed\` in the same step that finishes it. Do not batch completions.
3. **Write before the turn ends** — if a step you finished is still open when you send your final message, call \`todo_write\` first. The panel shows exactly what you wrote: items you never reported stay open and are marked "not reported".
4. **Full replace** — every call sends the WHOLE list; items you omit disappear. There is no hidden state, so a new task always starts a clean list.
5. **Adjustable plan** — while items are still \`pending\` you may restructure/rewrite the list freely in response to new information.
6. Skip the tool only for trivial single-step requests.

Each item: { content: string, status: "pending" | "in_progress" | "completed", id?: string }. Keep \`id\` stable for unchanged items so timers stay attached.
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