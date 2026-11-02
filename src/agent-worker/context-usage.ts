import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type {
  ContextUsageSegment,
  SessionContextUsage,
} from "../shared/protocol";
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

/**
 * Count turns/steps/tools on the ACTIVE branch (leaf path) only.
 *
 * Pi's `SessionManager.getSessionStats()` iterates EVERY stored entry, so it
 * double-counts user/assistant messages from abandoned branches (re-edits,
 * rollbacks, auto-recover re-sends, superseded forks). The chat UI shows the
 * leaf path, so stats must match that — otherwise "actual 2 rounds" shows as
 * "round 5" after a few retries left orphan user entries in the session tree.
 *
 * Returns null when the branch is unavailable (caller falls back to the SDK).
 */
function activeBranchStats(active: AgentSession): {
  users: number;
  assistants: number;
  toolResults: number;
  toolCalls: number;
} | null {
  let users = 0;
  let assistants = 0;
  let toolResults = 0;
  let toolCalls = 0;
  try {
    const branch = active.sessionManager?.getBranch?.() ?? [];
    if (!branch.length) return null;
    for (const entry of branch) {
      if (!entry || entry.type !== "message") continue;
      const message = entry.message as
        | { role?: unknown; content?: unknown }
        | undefined;
      if (!message || typeof message !== "object") continue;
      const role = message.role;
      if (role === "user") {
        users += 1;
      } else if (role === "toolResult") {
        toolResults += 1;
      } else if (role === "assistant") {
        assistants += 1;
        if (Array.isArray(message.content)) {
          toolCalls += message.content.filter(
            (part) =>
              Boolean(part) &&
              typeof part === "object" &&
              (part as { type?: unknown }).type === "toolCall",
          ).length;
        }
      }
    }
  } catch {
    // best-effort — caller falls back to SDK totals
  }
  return { users, assistants, toolResults, toolCalls };
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
  let costUsd: number | null = null;
  try {
    const stats = active.getSessionStats();
    if (stats && typeof stats === "object") {
      if (typeof stats.toolCalls === "number") toolCalls = stats.toolCalls;
      if (typeof (stats as { cost?: unknown }).cost === "number") {
        costUsd = (stats as { cost: number }).cost;
      }
      // Prefer the active-branch counts: orphaned/abandoned branches must not
      // inflate rounds/steps/tools. Fall back to SDK totals only when the
      // branch is unavailable (e.g. worker not yet bound to a session).
      const branchStats = activeBranchStats(active);
      const users =
        branchStats != null
          ? branchStats.users
          : typeof stats.userMessages === "number"
            ? stats.userMessages
            : 0;
      const assistants =
        branchStats != null
          ? branchStats.assistants
          : typeof stats.assistantMessages === "number"
            ? stats.assistantMessages
            : 0;
      const toolResults =
        branchStats != null
          ? branchStats.toolResults
          : typeof stats.toolResults === "number"
            ? stats.toolResults
            : 0;
      if (branchStats != null) toolCalls = branchStats.toolCalls;
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
      costUsd,
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
      costUsd,
      segments,
    };
  }
  return null;
}

