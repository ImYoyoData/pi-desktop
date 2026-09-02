import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  ContextUsageSegment,
  SessionContextUsage,
} from "../shared/protocol";
import type { SessionTiming } from "../shared/session-timing";

export type { SessionTiming } from "../shared/session-timing";

function charsToTokens(chars: number): number {
  return Math.max(0, Math.ceil(Math.max(0, chars) / 4));
}

function contentChars(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (typeof p.text === "string") n += p.text.length;
    if (typeof p.thinking === "string") n += p.thinking.length;
    if (typeof p.summary === "string") n += p.summary.length;
    if (p.type === "toolCall") {
      n +=
        String(p.name ?? "").length + JSON.stringify(p.arguments ?? {}).length;
    }
    // Cap image payloads so screenshots don't explode the estimate.
    if (typeof p.data === "string") n += Math.min(p.data.length, 512);
  }
  return n;
}

function estimateMessageTokens(message: unknown): {
  role: string;
  tokens: number;
} {
  if (!message || typeof message !== "object") return { role: "", tokens: 0 };
  const msg = message as Record<string, unknown>;
  const role = typeof msg.role === "string" ? msg.role : "";
  if (role === "assistant") {
    return { role, tokens: charsToTokens(contentChars(msg.content)) };
  }
  if (role === "user" || role === "toolResult" || role === "custom") {
    return { role, tokens: charsToTokens(contentChars(msg.content)) };
  }
  if (role === "branchSummary" || role === "compactionSummary") {
    const summary = typeof msg.summary === "string" ? msg.summary : "";
    return {
      role,
      tokens: charsToTokens(summary.length || contentChars(msg.content)),
    };
  }
  if (role === "bashExecution") {
    const command = typeof msg.command === "string" ? msg.command : "";
    const output = typeof msg.output === "string" ? msg.output : "";
    return { role, tokens: charsToTokens(command.length + output.length) };
  }
  return { role, tokens: charsToTokens(contentChars(msg.content)) };
}

function estimateSystemTokens(active: AgentSession): number {
  try {
    const prompt = active.systemPrompt ?? "";
    return charsToTokens(prompt.length);
  } catch {
    return 0;
  }
}

function estimateToolDefinitionTokens(active: AgentSession): number {
  try {
    const tools = active.getAllTools?.() ?? [];
    let chars = 0;
    for (const tool of tools) {
      chars += String(tool.name ?? "").length;
      chars += String(tool.description ?? "").length;
      try {
        chars += JSON.stringify(tool.parameters ?? {}).length;
      } catch {
        // ignore
      }
      if (Array.isArray(tool.promptGuidelines)) {
        for (const g of tool.promptGuidelines) chars += String(g).length;
      }
    }
    return charsToTokens(chars);
  } catch {
    return 0;
  }
}

function buildSegments(active: AgentSession): ContextUsageSegment[] {
  const system = estimateSystemTokens(active);
  const tools = estimateToolDefinitionTokens(active);
  let summarized = 0;
  let conversation = 0;
  let toolResults = 0;
  try {
    for (const message of active.messages ?? []) {
      const { role, tokens } = estimateMessageTokens(message);
      if (!tokens) continue;
      if (role === "branchSummary" || role === "compactionSummary")
        summarized += tokens;
      else if (role === "toolResult") toolResults += tokens;
      else conversation += tokens;
    }
  } catch {
    // ignore
  }

  const segments: ContextUsageSegment[] = [];
  if (system > 0) segments.push({ id: "system", tokens: system });
  if (tools > 0) segments.push({ id: "tools", tokens: tools });
  if (summarized > 0) segments.push({ id: "summarized", tokens: summarized });
  if (toolResults > 0)
    segments.push({ id: "toolResults", tokens: toolResults });
  if (conversation > 0)
    segments.push({ id: "conversation", tokens: conversation });
  return segments;
}

function scaleMessageSegments(
  segments: ContextUsageSegment[],
  targetTotal: number,
): ContextUsageSegment[] {
  const fixedIds = new Set(["system", "tools"]);
  const fixed = segments.filter((s) => fixedIds.has(s.id));
  const variable = segments.filter((s) => !fixedIds.has(s.id));
  const fixedSum = fixed.reduce((n, s) => n + s.tokens, 0);
  const variableSum = variable.reduce((n, s) => n + s.tokens, 0);
  const targetVariable = Math.max(0, targetTotal - fixedSum);
  if (variableSum <= 0 || targetVariable <= 0) {
    return [...fixed, ...variable].filter((s) => s.tokens > 0);
  }
  const scaled = variable.map((s) => ({
    ...s,
    tokens: Math.max(1, Math.round((s.tokens / variableSum) * targetVariable)),
  }));
  // Fix rounding drift on the largest variable segment.
  const drift = targetVariable - scaled.reduce((n, s) => n + s.tokens, 0);
  if (drift !== 0 && scaled.length) {
    const largest = scaled.reduce((a, b) => (a.tokens >= b.tokens ? a : b));
    largest.tokens = Math.max(1, largest.tokens + drift);
  }
  return [...fixed, ...scaled].filter((s) => s.tokens > 0);
}

export function readContextUsage(
  active: AgentSession,
): SessionContextUsage | null {
  let toolCalls: number | null = null;
  let messageCount: number | null = null;
  let turns: number | null = null;
  let steps: number | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let cacheReadTokens: number | null = null;
  let cacheWriteTokens: number | null = null;
  try {
    const stats = active.getSessionStats();
    if (stats && typeof stats === "object") {
      if (typeof stats.toolCalls === "number") toolCalls = stats.toolCalls;
      const users =
        typeof stats.userMessages === "number" ? stats.userMessages : 0;
      const assistants =
        typeof stats.assistantMessages === "number"
          ? stats.assistantMessages
          : 0;
      const toolResults =
        typeof stats.toolResults === "number" ? stats.toolResults : 0;
      messageCount = users + assistants + toolResults;
      turns = users;
      steps = assistants;
      const tokens = stats.tokens as
        | {
            input?: unknown;
            output?: unknown;
            cacheRead?: unknown;
            cacheWrite?: unknown;
          }
        | undefined;
      if (tokens && typeof tokens === "object") {
        const num = (v: unknown): number | null =>
          typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
        inputTokens = num(tokens.input);
        outputTokens = num(tokens.output);
        cacheReadTokens = num(tokens.cacheRead);
        cacheWriteTokens = num(tokens.cacheWrite);
      }
    }
  } catch {
    // stats are best-effort
  }

  let segments = buildSegments(active);
  const usage = active.getContextUsage();
  if (usage) {
    if (typeof usage.tokens === "number" && usage.tokens > 0) {
      segments = scaleMessageSegments(segments, usage.tokens);
    }
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      toolCalls,
      messageCount,
      turns,
      steps,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      segments,
    };
  }
  const contextWindow = active.model?.contextWindow;
  if (typeof contextWindow === "number" && contextWindow > 0) {
    const estimated = segments.reduce((n, s) => n + s.tokens, 0);
    return {
      tokens: estimated > 0 ? estimated : null,
      contextWindow,
      percent: estimated > 0 ? (estimated / contextWindow) * 100 : null,
      toolCalls,
      messageCount,
      turns,
      steps,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      segments,
    };
  }
  return null;
}

/**
 * Live session-timing tracker fed by the AgentSession event stream.
 *
 * Measures per-step LLM wall time (turn_start → message_end), first-token
 * latency (turn_start → first streamed delta), and decode throughput
 * (first token → message_end × reported output tokens). Totals accumulate
 * across the whole session; `snapshot()` also includes the in-flight step.
 */
const ZERO_TIMING: SessionTiming = {
  llmMs: 0,
  ttftMs: 0,
  ttftSteps: 0,
  decodeMs: 0,
  outputTokens: 0,
};

function roleOfMessage(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const msg = raw as Record<string, unknown>;
  return typeof msg.role === "string" ? msg.role : "";
}

function outputOfMessage(raw: unknown): number {
  if (!raw || typeof raw !== "object") return 0;
  const msg = raw as Record<string, unknown>;
  const usage = msg.usage;
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  return typeof u.output === "number" &&
    Number.isFinite(u.output) &&
    u.output > 0
    ? u.output
    : 0;
}

export class SessionTimingTracker {
  private timing: SessionTiming = { ...ZERO_TIMING };
  private turnStart: number | null = null;
  private stepStart: number | null = null;
  private firstToken: number | null = null;

  /** Feed one raw AgentSession event. */
  observe(event: unknown): void {
    const raw = event as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== "object") return;
    const type = raw.type;
    const now = Date.now();
    if (type === "turn_start") {
      this.turnStart = now;
      this.stepStart = now;
      this.firstToken = null;
      return;
    }
    if (type === "message_update") {
      if (this.firstToken === null && this.stepStart !== null) {
        const ev = raw.assistantMessageEvent as
          | Record<string, unknown>
          | undefined;
        const evType = typeof ev?.type === "string" ? ev.type : "";
        if (
          evType === "text_delta" ||
          evType === "thinking_delta" ||
          evType === "toolcall_delta" ||
          evType === "text_start" ||
          evType === "thinking_start" ||
          evType === "toolcall_start"
        ) {
          this.firstToken = now;
        }
      }
      return;
    }
    if (type === "message_end") {
      const msg = raw.message;
      if (roleOfMessage(msg) === "assistant") {
        if (this.stepStart !== null) {
          this.timing.llmMs += Math.max(0, now - this.stepStart);
          this.stepStart = null;
        }
        if (this.firstToken !== null) {
          if (this.turnStart !== null) {
            this.timing.ttftMs += Math.max(0, this.firstToken - this.turnStart);
            this.timing.ttftSteps += 1;
          }
          const out = outputOfMessage(msg);
          if (out > 0) {
            this.timing.decodeMs += Math.max(0, now - this.firstToken);
            this.timing.outputTokens += out;
          }
        }
        this.firstToken = null;
        this.turnStart = null;
      }
      return;
    }
    if (
      type === "agent_end" ||
      type === "agent_settled" ||
      type === "turn_end"
    ) {
      if (this.stepStart !== null) {
        this.timing.llmMs += Math.max(0, now - this.stepStart);
        this.stepStart = null;
      }
      this.firstToken = null;
      return;
    }
  }

  /** Current totals, including the in-flight step when one is open. */
  snapshot(): SessionTiming {
    const now = Date.now();
    const inflight =
      this.stepStart !== null ? Math.max(0, now - this.stepStart) : 0;
    return {
      ...this.timing,
      llmMs: this.timing.llmMs + inflight,
    };
  }

  restore(timing: SessionTiming): void {
    this.timing = { ...timing };
    this.turnStart = null;
    this.stepStart = null;
    this.firstToken = null;
  }

  reset(): void {
    this.timing = { ...ZERO_TIMING };
    this.turnStart = null;
    this.stepStart = null;
    this.firstToken = null;
  }
}
