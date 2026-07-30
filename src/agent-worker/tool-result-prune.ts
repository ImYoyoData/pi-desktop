/**
 * OpenCode-style prune: truncate old tool results while keeping a recent token
 * budget intact. Runs in-memory on AgentSession.messages (model context), without
 * rewriting the on-disk jsonl. Full outputs remain in the session file.
 */

export const TOOL_PRUNE_PROTECT_TOKENS = 40_000;
export const TOOL_PRUNE_MINIMUM_TOKENS = 20_000;
/** Match Pi compaction serialization truncation for tool results. */
export const TOOL_PRUNE_MAX_CHARS = 2_000;

const DEFAULT_PROTECTED_TOOLS = new Set(["skill", "ask_user"]);

export type AgentMessageLike = {
  role?: string;
  toolName?: string;
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

export type PruneOptions = {
  /** Keep newest tool-result tokens untouched (default 40_000). */
  protectTokens?: number;
  /** Skip prune unless at least this many tokens can be reclaimed (default 20_000). */
  minimumReclaimTokens?: number;
  /** Max characters kept per pruned tool result (default 2_000). */
  maxResultChars?: number;
  /** Tool names that are never truncated. */
  protectedToolNames?: Iterable<string>;
};

export type PruneResult = {
  prunedCount: number;
  tokensFreed: number;
  changed: boolean;
};

function charsToTokens(chars: number): number {
  return Math.max(0, Math.ceil(Math.max(0, chars) / 4));
}

export function textFromToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
  }
  return parts.join("\n");
}

export function estimateToolResultTokens(message: AgentMessageLike): number {
  const text = textFromToolContent(message.content);
  let chars = text.length;
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: unknown; data?: unknown };
      if (typeof p.data === "string") chars += Math.min(p.data.length, 512);
    }
  }
  return charsToTokens(chars);
}

function alreadyPruned(text: string): boolean {
  return /\[output truncated by prune/i.test(text);
}

function makeTruncatedContent(text: string, maxChars: number): { type: "text"; text: string }[] {
  const kept = text.slice(0, maxChars);
  const omitted = Math.max(0, text.length - maxChars);
  const marker =
    omitted > 0
      ? `\n\n[output truncated by prune — ${omitted} chars omitted]`
      : "\n\n[output truncated by prune]";
  return [{ type: "text", text: `${kept}${marker}` }];
}

/**
 * Mutates `messages` in place. Returns how many tool results were truncated.
 */
export function pruneOldToolResults(
  messages: AgentMessageLike[],
  opts?: PruneOptions,
): PruneResult {
  const protectTokens = opts?.protectTokens ?? TOOL_PRUNE_PROTECT_TOKENS;
  const minimumReclaim = opts?.minimumReclaimTokens ?? TOOL_PRUNE_MINIMUM_TOKENS;
  const maxChars = opts?.maxResultChars ?? TOOL_PRUNE_MAX_CHARS;
  const protectedNames = new Set(
    opts?.protectedToolNames ? [...opts.protectedToolNames] : DEFAULT_PROTECTED_TOOLS,
  );

  type Candidate = { index: number; tokensBefore: number; text: string };
  const candidates: Candidate[] = [];
  let protectBudget = Math.max(0, protectTokens);

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || msg.role !== "toolResult") continue;
    const toolName = typeof msg.toolName === "string" ? msg.toolName : "";
    if (protectedNames.has(toolName)) continue;

    const text = textFromToolContent(msg.content);
    const tokens = estimateToolResultTokens(msg);
    if (protectBudget > 0) {
      protectBudget -= tokens;
      continue;
    }
    if (alreadyPruned(text)) continue;
    if (text.length <= maxChars) {
      // Still drop embedded images from old results if present.
      if (Array.isArray(msg.content) && msg.content.some((p) => (p as { data?: unknown })?.data)) {
        candidates.push({ index: i, tokensBefore: tokens, text });
      }
      continue;
    }
    candidates.push({ index: i, tokensBefore: tokens, text });
  }

  let potentialFreed = 0;
  for (const c of candidates) {
    const after = charsToTokens(Math.min(c.text.length, maxChars) + 64);
    potentialFreed += Math.max(0, c.tokensBefore - after);
  }
  if (potentialFreed < minimumReclaim || candidates.length === 0) {
    return { prunedCount: 0, tokensFreed: 0, changed: false };
  }

  let prunedCount = 0;
  let tokensFreed = 0;
  for (const c of candidates) {
    const msg = messages[c.index]!;
    msg.content = makeTruncatedContent(c.text, maxChars);
    const after = estimateToolResultTokens(msg);
    tokensFreed += Math.max(0, c.tokensBefore - after);
    prunedCount += 1;
  }

  return { prunedCount, tokensFreed, changed: prunedCount > 0 };
}
