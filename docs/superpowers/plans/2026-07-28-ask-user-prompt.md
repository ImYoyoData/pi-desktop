# Ask-user interactive prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-blocking `ask_user` agent tool and a composer-top Q&A strip so the model can ask single/multi/button questions; user answers become a normal user message and start a new turn.

**Architecture:** Worker registers `ask_user` via `defineTool` (immediate ack). Tool args flow through existing `tool_execution_start` events into chat state `pendingAskUser`. `AskUserStrip` renders above Composer; confirm formats `[ask_user answers]` and calls `chat.sendPrompt`. Unrelated sends clear pending. System prompt text is appended beside project-orientation guidance.

**Tech Stack:** Electron utilityProcess worker, `@earendil-works/pi-coding-agent` (`defineTool`), TypeBox (`typebox`), Vue 3 + Pinia, Vitest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-ask-user-prompt-design.md`
- Scheme A only — non-blocking tool; answers via new user message / new turn
- UI: strip above composer (not message-stream quiz, not modal)
- Discard unconfirmed strip on unrelated send / newer `ask_user` / session clear
- Do not commit unless the user explicitly asks (user rule overrides “frequent commits” — mark commit steps optional)
- Reply / UI copy: zh-CN + en i18n keys

## File map

| Area | Primary files |
|------|----------------|
| Shared types + format/parse | `src/shared/ask-user.ts` (new), `src/shared/desktop-system-prompt.ts` |
| Worker tool | `src/agent-worker/ask-user-tool.ts` (new), `src/agent-worker/runtime.ts` |
| Chat state | `src/renderer/src/stores/chat-reducer.ts`, `src/renderer/src/stores/chat.ts` |
| UI | `src/renderer/src/components/AskUserStrip.vue` (new), `src/renderer/src/components/ChatPanel.vue`, `src/renderer/src/components/Composer.vue` |
| i18n | `src/renderer/src/i18n/zh-CN.ts`, `src/renderer/src/i18n/en.ts`, `src/renderer/src/i18n/index.ts` (if needed) |
| Tests | `tests/shared/ask-user.test.ts`, `tests/shared/desktop-system-prompt.test.ts`, `tests/renderer/chat-reducer.test.ts`, `tests/agent-worker/ask-user-tool.test.ts` |

---

### Task 1: Shared ask-user types, parse, format answers

**Files:**
- Create: `src/shared/ask-user.ts`
- Test: `tests/shared/ask-user.test.ts`

**Interfaces:**
- Produces: `AskUserQuestion`, `AskUserPrompt`, `AskUserAnswerDraft`, `parseAskUserArgs`, `formatAskUserAnswers`, `validateAskUserAnswers`

- [ ] **Step 1: Write failing tests**

Create `tests/shared/ask-user.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  formatAskUserAnswers,
  parseAskUserArgs,
  validateAskUserAnswers,
  type AskUserAnswerDraft,
} from "../../src/shared/ask-user";

describe("parseAskUserArgs", () => {
  it("parses a valid single-question payload", () => {
    const prompt = parseAskUserArgs({
      questions: [
        {
          id: "env",
          prompt: "Deploy where?",
          type: "single",
          options: [
            { id: "prod", label: "production" },
            { id: "other", label: "other", allowCustom: true },
          ],
        },
      ],
    });
    expect(prompt?.questions).toHaveLength(1);
    expect(prompt?.questions[0]?.type).toBe("single");
  });

  it("returns null for empty questions", () => {
    expect(parseAskUserArgs({ questions: [] })).toBeNull();
  });
});

describe("validateAskUserAnswers + formatAskUserAnswers", () => {
  const prompt = parseAskUserArgs({
    questions: [
      {
        id: "env",
        prompt: "Deploy where?",
        type: "single",
        options: [
          { id: "prod", label: "production" },
          { id: "other", label: "other", allowCustom: true },
        ],
      },
      {
        id: "flags",
        prompt: "Flags?",
        type: "multi",
        options: [
          { id: "a", label: "alpha" },
          { id: "b", label: "beta" },
          { id: "c", label: "custom", allowCustom: true },
        ],
      },
      {
        id: "go",
        prompt: "Proceed?",
        type: "buttons",
        options: [
          { id: "yes", label: "Confirm" },
          { id: "no", label: "Reject" },
        ],
      },
    ],
  })!;

  it("requires custom text when allowCustom option selected", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: ["other"], customText: "   " },
      flags: { optionIds: ["a"], customText: "" },
      go: { optionIds: ["yes"], customText: "" },
    };
    expect(validateAskUserAnswers(prompt, draft)).toMatch(/custom/i);
  });

  it("formats answers with prefix and ids", () => {
    const draft: AskUserAnswerDraft = {
      env: { optionIds: ["other"], customText: "canary 10%" },
      flags: { optionIds: ["a", "c"], customText: "extra" },
      go: { optionIds: ["no"], customText: "" },
    };
    expect(validateAskUserAnswers(prompt, draft)).toBeNull();
    const text = formatAskUserAnswers(prompt, draft);
    expect(text.startsWith("[ask_user answers]\n")).toBe(true);
    expect(text).toContain("(id=env)");
    expect(text).toContain("custom: canary 10%");
    expect(text).toContain("Reject");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/ask-user.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement shared module**

Create `src/shared/ask-user.ts`:

```ts
export type AskUserQuestionType = "single" | "multi" | "buttons";

export type AskUserOption = {
  id: string;
  label: string;
  allowCustom?: boolean;
};

export type AskUserQuestion = {
  id: string;
  prompt: string;
  type: AskUserQuestionType;
  options: AskUserOption[];
};

export type AskUserPrompt = {
  questions: AskUserQuestion[];
};

/** Per-question UI draft keyed by question id. */
export type AskUserAnswerDraft = Record<
  string,
  {
    optionIds: string[];
    customText: string;
  }
>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseOption(raw: unknown): AskUserOption | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!id || !label) return null;
  return {
    id,
    label,
    ...(o.allowCustom === true ? { allowCustom: true } : {}),
  };
}

function parseQuestion(raw: unknown): AskUserQuestion | null {
  const q = asRecord(raw);
  if (!q) return null;
  const id = typeof q.id === "string" ? q.id.trim() : "";
  const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
  const type = q.type;
  if (!id || !prompt) return null;
  if (type !== "single" && type !== "multi" && type !== "buttons") return null;
  if (!Array.isArray(q.options)) return null;
  const options: AskUserOption[] = [];
  const seen = new Set<string>();
  for (const item of q.options) {
    const opt = parseOption(item);
    if (!opt) continue;
    if (seen.has(opt.id)) continue;
    seen.add(opt.id);
    options.push(opt);
  }
  if (options.length === 0) return null;
  return { id, prompt, type, options };
}

/** Returns null if args are unusable for UI. */
export function parseAskUserArgs(args: unknown): AskUserPrompt | null {
  const root = asRecord(args);
  if (!root || !Array.isArray(root.questions) || root.questions.length === 0) return null;
  const questions: AskUserQuestion[] = [];
  const seenQ = new Set<string>();
  for (const item of root.questions) {
    const q = parseQuestion(item);
    if (!q) continue;
    if (seenQ.has(q.id)) continue;
    seenQ.add(q.id);
    questions.push(q);
  }
  if (questions.length === 0) return null;
  return { questions };
}

export function validateAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): string | null {
  for (const q of prompt.questions) {
    const ans = draft[q.id];
    if (!ans || ans.optionIds.length === 0) {
      return `Missing answer for: ${q.prompt}`;
    }
    if (q.type === "single" || q.type === "buttons") {
      if (ans.optionIds.length !== 1) {
        return `Select exactly one option for: ${q.prompt}`;
      }
    }
    const selected = q.options.filter((o) => ans.optionIds.includes(o.id));
    if (selected.length !== ans.optionIds.length) {
      return `Invalid option for: ${q.prompt}`;
    }
    const needsCustom = selected.some((o) => o.allowCustom);
    if (needsCustom && !ans.customText.trim()) {
      return `Custom text required for: ${q.prompt}`;
    }
  }
  return null;
}

export function formatAskUserAnswers(
  prompt: AskUserPrompt,
  draft: AskUserAnswerDraft,
): string {
  const lines = ["[ask_user answers]"];
  prompt.questions.forEach((q, i) => {
    const ans = draft[q.id]!;
    const selected = q.options.filter((o) => ans.optionIds.includes(o.id));
    const labels = selected.map((o) => o.label).join(", ");
    const needsCustom = selected.some((o) => o.allowCustom);
    const custom =
      needsCustom && ans.customText.trim()
        ? `; custom: ${ans.customText.trim()}`
        : "";
    lines.push(`${i + 1}. (id=${q.id}) ${q.prompt} → ${labels}${custom}`);
  });
  return lines.join("\n");
}

export const ASK_USER_TOOL_NAME = "ask_user";
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/shared/ask-user.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional — only if user asked)**

```bash
git add src/shared/ask-user.ts tests/shared/ask-user.test.ts
git commit -m "feat: add ask_user shared parse/format helpers"
```

---

### Task 2: Worker `ask_user` tool + system prompt

**Files:**
- Create: `src/agent-worker/ask-user-tool.ts`
- Modify: `src/agent-worker/runtime.ts`
- Modify: `src/shared/desktop-system-prompt.ts`
- Test: `tests/agent-worker/ask-user-tool.test.ts`, `tests/shared/desktop-system-prompt.test.ts`

**Interfaces:**
- Consumes: `ASK_USER_TOOL_NAME`, `parseAskUserArgs` from shared
- Produces: `createAskUserToolDefinition()`, `DESKTOP_ASK_USER_PROMPT`

- [ ] **Step 1: Write failing tool test**

Create `tests/agent-worker/ask-user-tool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createAskUserToolDefinition } from "../../src/agent-worker/ask-user-tool";

describe("createAskUserToolDefinition", () => {
  it("returns immediately with ack text", async () => {
    const tool = createAskUserToolDefinition();
    expect(tool.name).toBe("ask_user");
    const result = await tool.execute(
      "tc-1",
      {
        questions: [
          {
            id: "q1",
            prompt: "OK?",
            type: "buttons",
            options: [
              { id: "y", label: "Yes" },
              { id: "n", label: "No" },
            ],
          },
        ],
      },
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content.map((c) => ("text" in c ? c.text : "")).join("");
    expect(text).toMatch(/Await their next message/i);
  });

  it("rejects empty questions", async () => {
    const tool = createAskUserToolDefinition();
    await expect(
      tool.execute("tc-2", { questions: [] }, undefined, undefined, {} as never),
    ).rejects.toThrow(/question/i);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `npx vitest run tests/agent-worker/ask-user-tool.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement tool**

Create `src/agent-worker/ask-user-tool.ts`:

```ts
import { Type, type Static } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { ASK_USER_TOOL_NAME, parseAskUserArgs } from "../shared/ask-user";

const askUserSchema = Type.Object({
  questions: Type.Array(
    Type.Object({
      id: Type.String({ description: "Stable question id" }),
      prompt: Type.String({ description: "Question shown to the user" }),
      type: Type.Union([
        Type.Literal("single"),
        Type.Literal("multi"),
        Type.Literal("buttons"),
      ]),
      options: Type.Array(
        Type.Object({
          id: Type.String(),
          label: Type.String(),
          allowCustom: Type.Optional(
            Type.Boolean({
              description:
                "If true, selecting this option shows a free-text field (prefer last option for single/multi)",
            }),
          ),
        }),
        { minItems: 1 },
      ),
    }),
    { minItems: 1 },
  ),
});

export type AskUserToolInput = Static<typeof askUserSchema>;

const ACK =
  "Questions shown to the user. Await their next message with answers.";

export function createAskUserToolDefinition() {
  return defineTool({
    name: ASK_USER_TOOL_NAME,
    label: "Ask user",
    description:
      "Show an interactive question strip in Pi Desktop (single-select, multi-select, or buttons). Call when you need a clarifying choice. Turn ends after this tool; the user replies with a message starting with [ask_user answers].",
    promptSnippet:
      "Ask the user structured single/multi/button questions in the desktop UI",
    promptGuidelines: [
      "Use ask_user instead of only asking clarifying choices in prose when a discrete choice is needed.",
      "For free-text 'other', set allowCustom on the last option of single/multi.",
      "After ask_user returns, stop and wait for the user's next message.",
    ],
    parameters: askUserSchema,
    async execute(_toolCallId, params) {
      const parsed = parseAskUserArgs(params);
      if (!parsed) {
        throw new Error("ask_user: invalid or empty questions");
      }
      return {
        content: [{ type: "text" as const, text: ACK }],
      };
    },
  });
}
```

- [ ] **Step 4: Wire into runtime + prompt**

In `src/agent-worker/runtime.ts`:

- Import `createAskUserToolDefinition` and `DESKTOP_ASK_USER_PROMPT`.
- Change `appendSystemPrompt` to:

```ts
appendSystemPrompt: [
  DESKTOP_PROJECT_ORIENTATION_PROMPT,
  DESKTOP_ASK_USER_PROMPT,
],
```

- Extend `customTools`:

```ts
customTools: [
  defineTool(
    createBashToolDefinition(cwd, {
      operations: runTracker.operations,
    }),
  ),
  createAskUserToolDefinition(),
],
```

In `src/shared/desktop-system-prompt.ts` add:

```ts
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
```

Extend `tests/shared/desktop-system-prompt.test.ts`:

```ts
import {
  DESKTOP_ASK_USER_PROMPT,
  DESKTOP_PROJECT_ORIENTATION_PROMPT,
} from "../../src/shared/desktop-system-prompt";

// keep existing orientation test

describe("DESKTOP_ASK_USER_PROMPT", () => {
  it("documents ask_user usage", () => {
    expect(DESKTOP_ASK_USER_PROMPT).toContain("ask_user");
    expect(DESKTOP_ASK_USER_PROMPT).toContain("[ask_user answers]");
    expect(DESKTOP_ASK_USER_PROMPT).toContain("allowCustom");
  });
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npx vitest run tests/agent-worker/ask-user-tool.test.ts tests/shared/desktop-system-prompt.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit (optional)**

```bash
git add src/agent-worker/ask-user-tool.ts src/agent-worker/runtime.ts src/shared/desktop-system-prompt.ts tests/agent-worker/ask-user-tool.test.ts tests/shared/desktop-system-prompt.test.ts
git commit -m "feat: register non-blocking ask_user tool and system prompt"
```

---

### Task 3: Chat state — pending ask strip

**Files:**
- Modify: `src/renderer/src/stores/chat-reducer.ts`
- Modify: `src/renderer/src/stores/chat.ts` (`hydrateFromHistory`, `clearSession`, expose helpers)
- Test: `tests/renderer/chat-reducer.test.ts`

**Interfaces:**
- Consumes: `ASK_USER_TOOL_NAME`, `parseAskUserArgs`, `AskUserPrompt`
- Produces: `ChatState.pendingAskUser`, `clearPendingAskUser(state)`, reducer sets/clears pending

- [ ] **Step 1: Write failing reducer tests**

Append to `tests/renderer/chat-reducer.test.ts`:

```ts
import { ASK_USER_TOOL_NAME } from "../../src/shared/ask-user";

it("sets pendingAskUser on ask_user tool_execution_start", () => {
  let state = createChatState();
  state = reduceChatEvent(state, {
    type: "tool_execution_start",
    sessionId: "s1",
    toolCallId: "t1",
    toolName: ASK_USER_TOOL_NAME,
    args: {
      questions: [
        {
          id: "q1",
          prompt: "Pick",
          type: "single",
          options: [{ id: "a", label: "A" }],
        },
      ],
    },
  } as never);
  expect(state.pendingAskUser?.questions[0]?.id).toBe("q1");
});

it("clears pendingAskUser when appending a user message", () => {
  let state = createChatState();
  state = {
    ...state,
    pendingAskUser: {
      questions: [
        {
          id: "q1",
          prompt: "Pick",
          type: "single",
          options: [{ id: "a", label: "A" }],
        },
      ],
    },
  };
  state = appendUserMessage(state, "hello");
  expect(state.pendingAskUser).toBeNull();
});

it("replaces pendingAskUser on a newer ask_user call", () => {
  let state = createChatState();
  state = reduceChatEvent(state, {
    type: "tool_execution_start",
    sessionId: "s1",
    toolCallId: "t1",
    toolName: ASK_USER_TOOL_NAME,
    args: {
      questions: [
        {
          id: "old",
          prompt: "Old",
          type: "buttons",
          options: [{ id: "y", label: "Yes" }],
        },
      ],
    },
  } as never);
  state = reduceChatEvent(state, {
    type: "tool_execution_start",
    sessionId: "s1",
    toolCallId: "t2",
    toolName: ASK_USER_TOOL_NAME,
    args: {
      questions: [
        {
          id: "new",
          prompt: "New",
          type: "buttons",
          options: [{ id: "n", label: "No" }],
        },
      ],
    },
  } as never);
  expect(state.pendingAskUser?.questions[0]?.id).toBe("new");
});
```

Adjust the event cast to match whatever shape `reduceChatEvent` already expects in this file (follow existing `tool_execution_start` tests if present).

- [ ] **Step 2: Run tests — expect fail**

Run: `npx vitest run tests/renderer/chat-reducer.test.ts`

Expected: FAIL on `pendingAskUser`

- [ ] **Step 3: Implement state fields**

In `chat-reducer.ts`:

```ts
import {
  ASK_USER_TOOL_NAME,
  parseAskUserArgs,
  type AskUserPrompt,
} from "../../../shared/ask-user";

export type ChatState = {
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null;
  running: boolean;
  retryHint: ChatRetryHint | null;
  nextToolOrder: number;
  /** Interactive ask_user strip; null when none / discarded. */
  pendingAskUser: AskUserPrompt | null;
};

export function createChatState(): ChatState {
  return {
    messages: [],
    streamingMessage: null,
    running: false,
    retryHint: null,
    nextToolOrder: 1,
    pendingAskUser: null,
  };
}

export function clearPendingAskUser(state: ChatState): ChatState {
  if (!state.pendingAskUser) return state;
  return { ...state, pendingAskUser: null };
}
```

In `appendUserMessage`, always clear pending (`pendingAskUser: null`).

In `tool_execution_start` branch, after building the tool streaming message:

```ts
const pendingAskUser =
  String(payload.toolName ?? "") === ASK_USER_TOOL_NAME
    ? parseAskUserArgs(payload.args)
    : state.pendingAskUser;

return {
  ...state,
  running: true,
  messages,
  nextToolOrder: order + 1,
  pendingAskUser,
  streamingMessage: { /* existing tool stream fields */ },
};
```

When tool is `ask_user` and parse fails, set `pendingAskUser: null` (do not keep stale).

In `chat.ts` `hydrateFromHistory`, include `pendingAskUser: null`.

Expose from chat store:

```ts
function clearPendingAskUserFor(sessionId: string): void {
  bySession[sessionId] = clearPendingAskUser(stateFor(sessionId));
}

const activePendingAskUser = computed(() => {
  const id = sessionsStore.activeId;
  if (!id) return null;
  return stateFor(id).pendingAskUser;
});
```

Export `clearPendingAskUserFor` / `activePendingAskUser` from the store return object. Re-export `clearPendingAskUser` from reducer if useful.

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run tests/renderer/chat-reducer.test.ts`

Expected: PASS

- [ ] **Step 5: Commit (optional)**

```bash
git add src/renderer/src/stores/chat-reducer.ts src/renderer/src/stores/chat.ts tests/renderer/chat-reducer.test.ts
git commit -m "feat: track pending ask_user prompt in chat state"
```

---

### Task 4: AskUserStrip UI + ChatPanel mount

**Files:**
- Create: `src/renderer/src/components/AskUserStrip.vue`
- Modify: `src/renderer/src/components/ChatPanel.vue`
- Modify: `src/renderer/src/i18n/zh-CN.ts`, `src/renderer/src/i18n/en.ts` (and types if `t` is typed)

**Interfaces:**
- Consumes: `chat.activePendingAskUser`, `validateAskUserAnswers`, `formatAskUserAnswers`, `chat.sendPrompt`
- Produces: strip UI; confirm calls existing send path

- [ ] **Step 1: Add i18n keys**

In `zh-CN.ts`:

```ts
askUserConfirm: "确认",
askUserCustomPlaceholder: "请输入自定义意见",
askUserTitle: "请选择",
askUserToolLabel: "向用户提问",
```

In `en.ts`:

```ts
askUserConfirm: "Confirm",
askUserCustomPlaceholder: "Enter your custom answer",
askUserTitle: "Choose an option",
askUserToolLabel: "Ask user",
```

If i18n uses a shared type/interface, add the same keys there.

- [ ] **Step 2: Implement AskUserStrip.vue**

Create `src/renderer/src/components/AskUserStrip.vue` with:

- `v-if="chat.activePendingAskUser"`
- Per-question: `single`/`buttons` → `NRadioGroup`; `multi` → `NCheckboxGroup`
- Show `NInput` when selected option has `allowCustom`
- Primary button `t.askUserConfirm` → `validateAskUserAnswers` → `formatAskUserAnswers` → `chat.sendPrompt(sessionId, message)`
- Styles: bordered strip above composer, `max-height: 40vh`, scrollable
- Match Naive-UI radio/checkbox APIs already used in this repo

- [ ] **Step 3: Mount in ChatPanel**

In `ChatPanel.vue` template, above `<Composer />`:

```vue
      <AskUserStrip />
      <Composer />
```

Import:

```ts
import AskUserStrip from "@renderer/components/AskUserStrip.vue";
```

- [ ] **Step 4: Smoke via typecheck**

Run: `npm run typecheck`

Expected: no errors related to AskUserStrip / i18n keys

- [ ] **Step 5: Commit (optional)**

```bash
git add src/renderer/src/components/AskUserStrip.vue src/renderer/src/components/ChatPanel.vue src/renderer/src/i18n/zh-CN.ts src/renderer/src/i18n/en.ts
git commit -m "feat: add AskUserStrip above composer"
```

---

### Task 5: Discard pending on unrelated composer send (explicit)

**Files:**
- Modify: `src/renderer/src/components/Composer.vue` (only if send path can bypass `appendUserMessage`)
- Verify: `appendUserMessage` already clears pending (Task 3)

**Interfaces:**
- Consumes: `clearPendingAskUserFor` / `appendUserMessage` clear behavior
- Produces: guarantee that any successful user send clears the strip

- [ ] **Step 1: Audit send paths**

Confirm these all go through `chat.sendPrompt` → `appendUserMessage`:

- Composer primary send
- Queue “send now”
- Any other path that creates a user bubble

If a path sends agent commands **without** `appendUserMessage`, call `chat.clearPendingAskUserFor(sessionId)` immediately before that send.

- [ ] **Step 2: Add a focused unit test if a non-append path exists**

Only if you had to add an explicit clear helper call — otherwise rely on Task 3’s `appendUserMessage` test.

- [ ] **Step 3: Manual checklist**

1. `ask_user` tool call → strip visible.
2. Confirm → user bubble with `[ask_user answers]` → new turn.
3. Strip open + unrelated send → strip gone; only unrelated message sent.
4. Second `ask_user` replaces first strip content.

- [ ] **Step 4: Commit (optional)**

Only if Composer changed.

---

### Task 6: Mute ask_user tool card (light polish)

**Files:**
- Modify: `src/renderer/src/components/ToolCallCard.vue` and/or `MessageList.vue`

**Interfaces:**
- Consumes: `ASK_USER_TOOL_NAME`
- Produces: collapsed/muted label for ask_user tool rows

- [ ] **Step 1: When `toolName === 'ask_user'`, show short label**

Use i18n `askUserToolLabel`; hide large JSON args body by default (collapsed).

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`

- [ ] **Step 3: Commit (optional)**

```bash
git add src/renderer/src/components/ToolCallCard.vue src/renderer/src/i18n/zh-CN.ts src/renderer/src/i18n/en.ts
git commit -m "chore: mute ask_user tool card in message list"
```

---

### Task 7: Verification gate

**Files:** none (commands only)

- [ ] **Step 1: Run unit tests**

```bash
npx vitest run tests/shared/ask-user.test.ts tests/agent-worker/ask-user-tool.test.ts tests/shared/desktop-system-prompt.test.ts tests/renderer/chat-reducer.test.ts
```

Expected: all PASS

- [ ] **Step 2: Full typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 3: Spec coverage self-check**

Confirm each locked decision in the design spec maps to a task above (tool, non-blocking, strip, discard, format, system prompt, buttons/single/multi/custom).

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `ask_user` custom tool | Task 2 |
| Non-blocking execute | Task 2 |
| Answer as user message / new turn | Task 4 |
| Multi questions per call | Task 1–4 |
| Discard on unrelated send | Task 3 + 5 |
| Strip above composer | Task 4 |
| single / multi / buttons + allowCustom | Task 1 + 4 |
| System prompt | Task 2 |
| Muted tool card | Task 6 |
| Format `[ask_user answers]` | Task 1 + 4 |

## Placeholder / consistency notes

- Tool name constant: always `ASK_USER_TOOL_NAME` (`"ask_user"`).
- Pending field name: always `pendingAskUser`.
- Formatter prefix: always `[ask_user answers]`.
- Commit steps are optional per user rule.
