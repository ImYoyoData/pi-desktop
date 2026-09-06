/**
 * Cumulative per-session changed-file summary for the docked chat input
 * stack (Copilot "working set" equivalent).
 *
 * Unlike the turn-scoped `turn-file-changes.ts`, this walks the WHOLE active
 * session transcript (committed rows + the in-flight streaming tool) and
 * aggregates every edit/write tool card into one per-path +/- line count.
 * Because the transcript only grows, each file's additions/deletions are the
 * sum of every mutation the agent applied to it so far in this session.
 */
import type { ChatMessage } from "../stores/chat-reducer";
import type { ToolCard, ToolMessage } from "./tool-diff";
import { toolCardFor } from "./tool-diff";

export type SessionFileChange = {
	path: string;
	additions: number;
	deletions: number;
};

function toolCard(msg: ToolMessage): ToolCard {
	return toolCardFor(msg);
}

/**
 * Merge a single tool card into the accumulator. Only file mutations with a
 * known path + diff stats count; reads / bash / todo / generic never do.
 */
function mergeInto(
	acc: Map<string, SessionFileChange>,
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
 * Cumulative +/- across `messages` (committed rows) plus an optional live
 * streaming row. Result is sorted by path for stable rendering.
 */
export function aggregateFileChanges(
	messages: readonly ChatMessage[],
	streaming: ChatMessage | null = null,
): SessionFileChange[] {
	const acc = new Map<string, SessionFileChange>();
	for (const msg of messages) {
		if (msg.role === "tool") mergeInto(acc, toolCard(msg));
	}
	if (streaming?.role === "tool") mergeInto(acc, toolCard(streaming));
	return [...acc.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Cheap presence check used by the input stack to decide whether the changed
 * files dock should render. Shares `toolCard`'s WeakMap cache, so parsing is
 * paid once even when both this and `aggregateFileChanges` run per render.
 */
export function hasAnyFileChange(
	messages: readonly ChatMessage[],
	streaming: ChatMessage | null = null,
): boolean {
	for (const msg of messages) {
		if (msg.role !== "tool") continue;
		const card = toolCard(msg);
		if (
			(card.kind === "edit" || card.kind === "write") &&
			card.path &&
			card.stats
		) {
			return true;
		}
	}
	if (streaming?.role === "tool") {
		const card = toolCard(streaming);
		return (
			(card.kind === "edit" || card.kind === "write") &&
			card.path != null &&
			card.stats != null
		);
	}
	return false;
}
