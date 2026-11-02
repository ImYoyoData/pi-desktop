# Ask-user interactive prompt — Design

> **现状对照（2026-11）**：已实现，但多项决策已改。保留：`ask_user` 自定义工具、UI 显示在当前消息流里。偏离：`execute` 改成**阻塞等待**（`waitForAnswers` 等 RPC 答案、无超时，只有 Stop 会中断），答案作为 **tool result** 交回模型，不再是非阻塞的「回合先结束 + 回答当普通 user message 开新回合」；回答走 `sessions.askUserReply`，不经 `sendPrompt`。UI 从 composer 上方浮动条改为**内嵌消息流卡片**（多题短标签、图片附件），组件名为遗迹；协议对齐 Codex 问答格式（`header` / `isSecret`、题目与选项数量校验、JSON 答案）。本文的 Decisions 表与工具契约属于历史设计，以此注记为准。

**Date:** 2026-07-28  
**Status:** Approved  
**Product:** Pi Desktop  
**Approach:** A — Non-blocking `ask_user` custom tool + composer-top strip

## Goal

Let the agent ask structured questions in the current chat session via a dedicated tool. The UI shows a floating strip above the composer. The agent turn ends when the tool runs; after the user confirms, answers are sent as a normal user message and a new turn starts. Unconfirmed prompts are discarded if the user sends something else.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Invoke mechanism | Custom tool `ask_user` |
| While waiting | Agent turn keeps running: `execute` awaits the answer |
| After confirm | Answers returned as the tool result |
| Question count | One or many per call; model decides |
| Pending + new send | Discard / ignore unconfirmed strip |
| UI placement | Floating strip above composer (not message stream, not modal) |
| Answer visibility | Plain user bubble in chat |
| Custom input | Last option may set `allowCustom` on `single` / `multi` |
| Confirm/reject style | `type: "buttons"` |

## Tool contract

### Name

`ask_user`

### Parameters

```ts
{
  questions: Array<{
    id: string
    prompt: string
    type: "single" | "multi" | "buttons"
    options: Array<{
      id: string
      label: string
      /** For single/multi: when true, selecting this option shows a free-text field. Prefer only the last option. */
      allowCustom?: boolean
    }>
  }>
}
```

### Semantics by `type`

| type | Behavior |
|------|----------|
| `single` | Exactly one option. If chosen option has `allowCustom`, require non-empty custom text before confirm. |
| `multi` | One or more options required before confirm. Custom text required if an `allowCustom` option is selected. |
| `buttons` | Mutually exclusive button group (confirm / reject / other labels). Selecting one answers that question. |

### Execute

- Non-blocking: return immediately with a short fixed message, e.g. `Questions shown to the user. Await their next message with answers.`
- Do **not** wait on IPC for the user’s choice.
- Turn ends via normal agent lifecycle after the tool completes.

### Validation (worker)

- Reject empty `questions`.
- Each question needs non-empty `id`, `prompt`, and ≥1 `options`.
- Option `id` / `label` non-empty; `id` unique within a question.

## UI / interaction

1. When the session receives an `ask_user` tool call (args parsed), show a strip **above the composer** for that session pane.
2. Strip contents: question prompts + controls matching type; primary **确认** submits the whole set.
3. On **确认**:
   - Validate required selections / custom text.
   - Format answers as a user message (see below).
   - Clear pending strip.
   - Send message through the existing composer/send path (new agent turn).
4. Discard pending strip when any of:
   - User sends a different message (composer send without confirming strip).
   - User switches away in a way that starts another send for that session.
   - A newer `ask_user` call replaces the previous pending set for the same session.
5. Message list may show a muted/collapsed tool card for `ask_user`; primary UX is the strip, not an inline quiz card.

## User message format (after confirm)

Human-readable, stable for the model:

```text
[ask_user answers]
1. (id=<questionId>) <prompt> → <optionLabel>
2. (id=<questionId>) <prompt> → <optionLabel>, <optionLabel>; custom: <text>
```

Rules:

- Prefix line `[ask_user answers]` so the model can detect answers.
- One numbered line per question.
- Include `id` and prompt text for grounding.
- For multi: comma-separated selected labels; append `; custom: …` when custom text was provided.
- For buttons: single selected button label.

## System prompt (internal)

Append via existing `appendSystemPrompt` (same path as project-orientation prompt):

- When a clarifying choice is needed, call `ask_user` instead of only asking in prose.
- Use `single` / `multi` / `buttons` as appropriate; put free-text “other” as last option with `allowCustom: true`.
- May include multiple questions in one call.
- After the tool returns, stop; the user’s next message will contain `[ask_user answers]` or a different instruction (they may ignore the quiz).
- Do not invent fake tool results; wait for the real user message.

## Architecture (sketch)

```
agent-worker: defineTool(ask_user) → execute returns ack
     ↓ tool_call event (sanitized)
main / renderer session event bus
     ↓
session store: pendingAskUser | null
     ↓
AskUserStrip above Composer
     ↓ confirm → format → send user message
```

## Non-goals (v1)

- Blocking tool that resumes the same turn with a tool result
- Quiz as the primary card inside the message stream
- Auto-timeout / auto-dismiss by timer
- Re-opening discarded prompts from history
- Persisting pending strip across app restart
- i18n polish beyond existing locale patterns (can reuse common Confirm label)

## Test plan

- Model calls `ask_user` with one `single` question → strip appears; confirm → user message with `[ask_user answers]`; new turn starts.
- `multi` + last `allowCustom` → custom field only when that option selected; empty custom blocks confirm.
- `buttons` confirm/reject → correct label in user message.
- Multiple questions in one call → all validated; one combined user message.
- Pending strip + user types unrelated message and sends → strip cleared; unrelated message only.
- Second `ask_user` while pending → replaces previous pending set.
- Tool `execute` does not hang the worker.

## Open questions

None for v1 (locked above).  
