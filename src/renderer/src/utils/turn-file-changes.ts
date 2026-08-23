/**
 * Per-turn changed-file summary (opencode DiffSummary row).
 *
 * Walks the message list turn-by-turn (split on user prompts) and aggregates
 * edit/write tool cards into per-file +/- line counts. Each turn's summary is
 * attached to the id of its LAST non-user row so MessageList can render it
 * right after the final answer.
 */
import type { ChatMessage } from "../stores/chat-reducer";
import type { ToolCard } from "./tool-diff";
import { parseToolCard } from "./tool-diff";

export type TurnFileChange = {
	path: string;
	additions: number;
	deletions: number;
};

export type TurnFileChanges = {
	files: TurnFileChange[];
	totalAdditions: number;
	totalDeletions: number;
};

type ParseTool = (msg: Extract<ChatMessage, { role: "tool" }>) => ToolCard;

function mergeInto(
	acc: Map<string, TurnFileChange>,
	card: ToolCard,
): void {
	if ((card.kind !== "edit" && card.kind !== "write") || !card.path) return;
	if (!card.stats) return;
	const prev = acc.get(card.path);
	if (prev) {
		prev.additions += card.stats.additions;
		prev.deletions += card.stats.deletions;
		return;
	}
	acc.set(card.path, {
		path: card.path,
		additions: card.stats.additions,
		deletions: card.stats.deletions,
	});
}

/**
 * Build Map<lastRowIdOfTurn, summary>. When `includeTrailing` is true the
 * still-open trailing turn (finished run, no follow-up prompt yet) is also
 * summarized — used once the agent stops responding.
 */
export function collectTurnFileChanges(
	messages: ChatMessage[],
	parseTool: ParseTool = parseToolCard,
	includeTrailing = false,
): Map<string, TurnFileChanges> {
	const out = new Map<string, TurnFileChanges>();
	let acc = new Map<string, TurnFileChange>();
	let lastRowId: string | null = null;

	const flush = () => {
		if (!lastRowId || acc.size === 0) return;
		const files = [...acc.values()].sort((a, b) =>
			a.path.localeCompare(b.path),
		);
		out.set(lastRowId, {
			files,
			totalAdditions: files.reduce((n, f) => n + f.additions, 0),
			totalDeletions: files.reduce((n, f) => n + f.deletions, 0),
		});
	};

	for (const msg of messages) {
		if (msg.role === "user") {
			flush();
			acc = new Map();
			lastRowId = null;
			continue;
		}
		lastRowId = msg.id;
		if (msg.role === "tool") mergeInto(acc, parseTool(msg));
	}
	if (includeTrailing) flush();
	return out;
}
