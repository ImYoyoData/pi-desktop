/**
 * Composer agent modes — persistent toolbar selector (not editor capsules).
 * Injected into the agent prompt when sending.
 */

export type ComposerAgentMode = "agent" | "ask" | "plan" | "task";

export const COMPOSER_MODE_MARKER_PREFIX = "[pi-desktop mode:";

export const COMPOSER_AGENT_MODES: readonly ComposerAgentMode[] = [
  "agent",
  "ask",
  "plan",
  "task",
] as const;

export function isComposerAgentMode(value: unknown): value is ComposerAgentMode {
  return value === "agent" || value === "ask" || value === "plan" || value === "task";
}

/**
 * Remove the injected mode marker + instructions from user-visible message text.
 * Agent still receives the full preamble; the chat bubble should not.
 */
export function stripComposerModePreamble(text: string): string {
  const raw = text ?? "";
  if (!raw.startsWith(COMPOSER_MODE_MARKER_PREFIX)) return raw;
  const sep = raw.indexOf("\n\n");
  if (sep < 0) return "";
  return raw.slice(sep + 2);
}

export function composerModePreamble(mode: ComposerAgentMode): string {
  switch (mode) {
    case "agent":
      return `${COMPOSER_MODE_MARKER_PREFIX} agent]
You are in **Agent mode** (default coding agent).
- Investigate and implement as a normal coding agent.
- When you need a clarifying choice from the user, call \`ask_user\` (do not only ask in prose).
- Prefer progressing the task; pause for \`ask_user\` on ambiguous product decisions or irreversible actions.`;
    case "ask":
      return `${COMPOSER_MODE_MARKER_PREFIX} ask]
You are in **Ask mode** (read-only Q&A).
- Answer the user's questions about the codebase or environment.
- You may read files and run **non-mutating** inspection commands (ls, cat, grep, find, git status/log/diff, etc.).
- Do **not** edit/write files, apply patches, commit, install packages, or run destructive/mutating commands.
- Prefer concise, accurate answers with path citations when helpful.
- Use \`ask_user\` only if a clarifying choice is truly needed.`;
    case "plan":
      return `${COMPOSER_MODE_MARKER_PREFIX} plan]
You are in **Plan mode** (planning only — not the same as auto-task execution).
- Lead with clarifying questions via \`ask_user\` (prefer structured choices).
- Explore the codebase with read-only tools as needed to ground the plan.
- Do **not** implement the work yet (no edits, no commits, no destructive commands).
- Produce a concrete markdown plan (goals, steps, risks, open questions).
- Prefer writing the plan to a file such as \`PLAN.md\` (or a path the user chose) when ready.
- Call \`ask_user\` with confirm/reject (and optional revise) before treating the plan as accepted.
- Stop after presenting the plan / waiting for confirmation — do not auto-execute.`;
    case "task":
      return `${COMPOSER_MODE_MARKER_PREFIX} task]
You are in **Task mode** (plan → confirm → fully automatic delivery).
- Clarify the desired end state with \`ask_user\` when ambiguous.
- Draft a short execution plan, then call \`ask_user\` with confirm/reject **before** starting implementation.
- After the user confirms, autonomously implement using available tools (edit, bash, MCP, etc.).
- Self-check: run relevant tests/commands, fix failures, and verify the goal is met end-to-end.
- Prefer finishing the goal rather than stopping at a partial sketch — pause for \`ask_user\` only on irreversible / high-risk decisions.`;
    default: {
      const _never: never = mode;
      return String(_never);
    }
  }
}

/** Appended to every session so the model understands toolbar modes. */
export const DESKTOP_COMPOSER_MODES_PROMPT = `## Composer modes (Pi Desktop)

The user's message may begin with a line like \`[pi-desktop mode: agent|ask|plan|task]\` plus mode rules.
Honor that mode for the turn (and follow-ups until a different mode marker appears).

- **agent** (default): normal coding agent; use \`ask_user\` when a clarifying choice is needed.
- **ask**: read-only Q&A; inspect with read/query tools only; never mutate the workspace.
- **plan**: clarify via \`ask_user\`, research read-only, write a markdown plan, wait for confirmation — do **not** implement / auto-execute.
- **task** (Task mode): clarify outcome, propose a plan and get \`ask_user\` confirmation, then **fully automatically** implement and self-test to completion.

Plan mode and Task mode are different: plan stops at the plan; task executes after confirmation.
`;
