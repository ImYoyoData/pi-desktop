/**
 * Cursor-style process timeline:
 *
 *   Exploring 6 files, 1 search ⌄     ← foldable summary (default collapsed)
 *     Read foo.ts L1-100               ← details when expanded
 *     Grepped query…
 *     Thought 34s
 *   Reading MessageList.vue L2088-2137 ← CURRENT action (always below)
 *
 * Segments split on user prompts and assistant answer text so each
 * process burst stays as its own stable summary block.
 */
import type { ChatMessage } from "../stores/chat-reducer";
import type { ToolCard } from "./tool-diff";
import {
	isBashTool,
	isFileMutationTool,
	isReadTool,
	parseToolCard,
} from "./tool-diff";

export type ProcessStepKind =
	| "read"
	| "edit"
	| "write"
	| "search"
	| "bash"
	| "thought"
	| "other";

export type ProcessStep = {
	id: string;
	kind: ProcessStepKind;
	/** Darker verb: Read / Edited / Grepped / Thought */
	verb: string;
	/** Lighter detail: filename, query, duration */
	detail: string;
	additions?: number;
	deletions?: number;
	/** Nested incremental edits to the same file (optional). */
	children?: ProcessStep[];
};

export type TurnProcessStats = {
	editedFiles: number;
	exploredFiles: number;
	searches: number;
	otherTools: number;
	additions: number;
	deletions: number;
	hasThinking: boolean;
	thinkingDurationMs: number | null;
	live: boolean;
	/** True only while a thinking block is actively streaming. */
	thinkingStreaming: boolean;
	/** Header uses Exploring vs Explored / Editing vs Edited. */
	primary: "explore" | "edit" | "thought" | "mixed";
};

export type TurnProcessAnchor = {
	/**
	 * Message id where the summary row is rendered.
	 * Cursor places this at the END of the process burst (last tool / thinking),
	 * immediately above the next assistant conclusion — never stuck at the top.
	 */
	anchorId: string;
	/** Stable segment identity (first process message) for Vue keys. */
	segmentId: string;
	hiddenIds: Set<string>;
	stats: TurnProcessStats;
	steps: ProcessStep[];
	/** Always-visible current/latest line under the summary. */
	liveAction: string | null;
	thinkingMsgIds: string[];
	toolMsgIds: string[];
};

type ParseTool = (msg: Extract<ChatMessage, { role: "tool" }>) => ToolCard;

export type CollectProcessOpts = {
	trailingLive?: boolean;
};

function isSearchTool(toolName: string): boolean {
	const n = toolName.toLowerCase();
	return (
		(n.includes("search") ||
			n.includes("grep") ||
			n === "find" ||
			n === "glob" ||
			n === "list_dir" ||
			n === "list_directory") &&
		!isFileMutationTool(toolName)
	);
}

function basename(path: string | null | undefined): string {
	if (!path) return "file";
	const norm = path.replace(/\\/g, "/");
	const i = norm.lastIndexOf("/");
	return i >= 0 ? norm.slice(i + 1) : norm;
}

function truncate(s: string, max = 42): string {
	const t = s.replace(/\s+/g, " ").trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max - 1)}…`;
}

function emptyStats(): TurnProcessStats {
	return {
		editedFiles: 0,
		exploredFiles: 0,
		searches: 0,
		otherTools: 0,
		additions: 0,
		deletions: 0,
		hasThinking: false,
		thinkingDurationMs: null,
		live: false,
		thinkingStreaming: false,
		primary: "explore",
	};
}

function readLineRange(card: ToolCard): string {
	if (card.kind !== "read") return "";
	const start = card.startLine;
	const lines = card.linesRead;
	if (start != null && lines != null && lines > 0) {
		return `L${start}-${start + lines - 1}`;
	}
	if (card.totalLines != null) return `L1-${card.totalLines}`;
	return "";
}

function searchDetail(
	msg: Extract<ChatMessage, { role: "tool" }>,
): string {
	const args = msg.args;
	if (args && typeof args === "object" && !Array.isArray(args)) {
		const rec = args as Record<string, unknown>;
		for (const key of ["pattern", "query", "search", "grep", "regex", "text"]) {
			const v = rec[key];
			if (typeof v === "string" && v.trim()) return truncate(v, 48);
		}
		const path = rec.path ?? rec.file ?? rec.glob;
		if (typeof path === "string" && path.trim()) return truncate(path, 48);
	}
	return msg.toolName;
}

function buildToolStep(
	msg: Extract<ChatMessage, { role: "tool" }>,
	parseTool: ParseTool,
	labels: { read: string; edited: string; grepped: string; ran: string; used: string },
): ProcessStep {
	const name = msg.toolName || "";
	const card = parseTool(msg);

	if (isSearchTool(name)) {
		return {
			id: msg.id,
			kind: "search",
			verb: labels.grepped,
			detail: searchDetail(msg),
		};
	}
	if (isReadTool(name)) {
		const path = card.kind === "read" ? card.path : null;
		const range = readLineRange(card);
		const detail = [basename(path), range].filter(Boolean).join(" ");
		return {
			id: msg.id,
			kind: "read",
			verb: labels.read,
			detail: detail || name,
		};
	}
	if (isFileMutationTool(name)) {
		const path =
			card.kind === "edit" || card.kind === "write" ? card.path : null;
		const stats =
			card.kind === "edit" || card.kind === "write" ? card.stats : null;
		return {
			id: msg.id,
			kind: card.kind === "write" ? "write" : "edit",
			verb: labels.edited,
			detail: basename(path),
			additions: stats?.additions,
			deletions: stats?.deletions,
		};
	}
	if (isBashTool(name)) {
		const cmd =
			card.kind === "bash" && card.command
				? truncate(card.command, 48)
				: name;
		return {
			id: msg.id,
			kind: "bash",
			verb: labels.ran,
			detail: cmd,
		};
	}
	return {
		id: msg.id,
		kind: "other",
		verb: labels.used,
		detail: truncate(name, 40),
	};
}

function liveActionForTool(
	msg: Extract<ChatMessage, { role: "tool" }>,
	parseTool: ParseTool,
	labels: {
		reading: string;
		editing: string;
		searching: string;
		running: string;
		planning: string;
	},
): string {
	const name = msg.toolName || "";
	const card = parseTool(msg);
	if (isReadTool(name)) {
		const path = card.kind === "read" ? card.path : null;
		const range = readLineRange(card);
		return [labels.reading, basename(path), range].filter(Boolean).join(" ");
	}
	if (isFileMutationTool(name)) {
		const path =
			card.kind === "edit" || card.kind === "write" ? card.path : null;
		return `${labels.editing} ${basename(path)}`;
	}
	if (isSearchTool(name)) {
		return `${labels.searching} ${searchDetail(msg)}`;
	}
	if (isBashTool(name)) {
		const cmd =
			card.kind === "bash" && card.command
				? truncate(card.command, 40)
				: name;
		return `${labels.running} ${cmd}`;
	}
	return labels.planning;
}

/** Merge consecutive edits to the same file into one parent with children. */
function nestEditSteps(steps: ProcessStep[]): ProcessStep[] {
	const out: ProcessStep[] = [];
	for (const step of steps) {
		const prev = out[out.length - 1];
		if (
			prev &&
			(prev.kind === "edit" || prev.kind === "write") &&
			(step.kind === "edit" || step.kind === "write") &&
			prev.detail === step.detail
		) {
			const children = prev.children ? [...prev.children] : [{ ...prev, children: undefined }];
			children.push(step);
			const additions = children.reduce((n, c) => n + (c.additions ?? 0), 0);
			const deletions = children.reduce((n, c) => n + (c.deletions ?? 0), 0);
			out[out.length - 1] = {
				...prev,
				id: prev.id,
				additions: additions || undefined,
				deletions: deletions || undefined,
				children: children.length > 1 ? children : undefined,
			};
			continue;
		}
		out.push(step);
	}
	return out;
}

function finalizePrimary(stats: TurnProcessStats): void {
	if (stats.editedFiles > 0 && stats.exploredFiles === 0 && stats.searches === 0) {
		stats.primary = "edit";
		return;
	}
	if (stats.editedFiles === 0 && (stats.exploredFiles > 0 || stats.searches > 0)) {
		stats.primary = "explore";
		return;
	}
	if (
		stats.editedFiles === 0 &&
		stats.exploredFiles === 0 &&
		stats.searches === 0 &&
		stats.hasThinking
	) {
		stats.primary = "thought";
		return;
	}
	stats.primary = "mixed";
}

/**
 * Build process segments. Each contiguous thinking/tool burst between
 * assistant answers becomes one Cursor summary block, anchored at the
 * END of the burst (so it sits just above the conclusion — not at the top).
 */
export function collectTurnProcessAnchors(
	messages: ChatMessage[],
	parseTool: ParseTool = (msg) =>
		parseToolCard(msg.toolName, msg.args, msg.result, {
			isError: msg.isError,
		}),
	opts: CollectProcessOpts = {},
	stepLabels = {
		read: "Read",
		edited: "Edited",
		grepped: "Grepped",
		ran: "Ran",
		used: "Used",
		thought: "Thought",
		briefly: "briefly",
		reading: "Reading",
		editing: "Editing",
		searching: "Searching",
		running: "Running",
		planning: "Planning next moves",
	},
): Map<string, TurnProcessAnchor> {
	const out = new Map<string, TurnProcessAnchor>();
	let stats = emptyStats();
	let edited = new Set<string>();
	let explored = new Set<string>();
	const hiddenIds = new Set<string>();
	const thinkingMsgIds: string[] = [];
	const toolMsgIds: string[] = [];
	const steps: ProcessStep[] = [];
	/** First process message in the open segment (stable identity). */
	let segmentId: string | null = null;
	/** Last process message — where the summary is rendered. */
	let lastProcessId: string | null = null;
	let hasProcess = false;
	let liveAction: string | null = null;
	let streamingTool: Extract<ChatMessage, { role: "tool" }> | null = null;

	const reset = () => {
		stats = emptyStats();
		edited = new Set();
		explored = new Set();
		hiddenIds.clear();
		thinkingMsgIds.length = 0;
		toolMsgIds.length = 0;
		steps.length = 0;
		segmentId = null;
		lastProcessId = null;
		hasProcess = false;
		liveAction = null;
		streamingTool = null;
	};

	const flush = (forceLive: boolean) => {
		if (!hasProcess || !segmentId || !lastProcessId) {
			reset();
			return;
		}
		stats.editedFiles = edited.size;
		stats.exploredFiles = explored.size;
		finalizePrimary(stats);

		if (streamingTool) {
			stats.live = true;
			liveAction = liveActionForTool(streamingTool, parseTool, stepLabels);
		} else if (forceLive) {
			stats.live = true;
			liveAction = stepLabels.planning;
		} else {
			stats.live = false;
			liveAction = null;
		}

		const ids = new Set(hiddenIds);
		// Summary row is visible on the last process message only.
		ids.delete(lastProcessId);
		out.set(lastProcessId, {
			anchorId: lastProcessId,
			segmentId,
			hiddenIds: ids,
			stats: { ...stats },
			steps: nestEditSteps([...steps]),
			liveAction,
			thinkingMsgIds: [...thinkingMsgIds],
			toolMsgIds: [...toolMsgIds],
		});
		reset();
	};

	for (const msg of messages) {
		if (msg.role === "user") {
			flush(false);
			continue;
		}

		if (msg.role === "assistant") {
			const hasText = Boolean(msg.text?.trim());
			const hasThinking =
				Boolean(msg.thinking?.trim()) || (msg.streaming && !msg.text);
			const alreadyInSegment =
				thinkingMsgIds.includes(msg.id) || lastProcessId === msg.id;

			// New answer message closes the prior tool/thinking burst so the
			// summary sits on the last process row — immediately above this text.
			if (hasText && hasProcess && !alreadyInSegment) {
				flush(false);
			}

			if (hasThinking) {
				hasProcess = true;
				if (!segmentId) segmentId = msg.id;
				lastProcessId = msg.id;
				stats.hasThinking = true;
				thinkingMsgIds.push(msg.id);
				// Never hide a row that also shows the conclusion text
				// (that was the "whole page goes blank" bug).
				if (!hasText) hiddenIds.add(msg.id);

				if (msg.streaming && !msg.text) {
					stats.live = true;
					stats.thinkingStreaming = true;
					liveAction = stepLabels.planning;
					streamingTool = null;
				} else {
					stats.thinkingStreaming = false;
					const dur = msg.thinkingDurationMs;
					if (dur != null && dur >= 0) {
						stats.thinkingDurationMs = Math.max(
							stats.thinkingDurationMs ?? 0,
							dur,
						);
					}
					const detail =
						dur != null && dur >= 2500
							? `${Math.round(dur / 1000)}s`
							: stepLabels.briefly;
					steps.push({
						id: `thought:${msg.id}`,
						kind: "thought",
						verb: stepLabels.thought,
						detail,
					});
				}
			}

			// Same bubble carries thinking + conclusion: close here so the
			// summary stays above the answer text in this row.
			if (hasText && hasProcess && (thinkingMsgIds.includes(msg.id) || lastProcessId === msg.id)) {
				flush(false);
			}
			continue;
		}

		if (msg.role === "tool") {
			hasProcess = true;
			if (!segmentId) segmentId = msg.id;
			lastProcessId = msg.id;
			hiddenIds.add(msg.id);
			toolMsgIds.push(msg.id);

			const name = msg.toolName || "";
			if (isReadTool(name)) {
				const card = parseTool(msg);
				const path =
					card.kind === "read" && card.path
						? card.path
						: `read:${msg.id}`;
				explored.add(path);
			} else if (isFileMutationTool(name)) {
				const card = parseTool(msg);
				const path =
					(card.kind === "edit" || card.kind === "write") && card.path
						? card.path
						: `edit:${msg.id}`;
				edited.add(path);
				if (
					(card.kind === "edit" || card.kind === "write") &&
					card.stats
				) {
					stats.additions += card.stats.additions;
					stats.deletions += card.stats.deletions;
				}
			} else if (isSearchTool(name)) {
				stats.searches += 1;
			} else {
				stats.otherTools += 1;
			}

			if (msg.streaming) {
				streamingTool = msg;
				stats.live = true;
			} else {
				steps.push(buildToolStep(msg, parseTool, stepLabels));
				if (streamingTool?.id === msg.id) streamingTool = null;
			}
		}
	}

	flush(Boolean(opts.trailingLive));
	return out;
}

export type ProcessSummaryLabels = {
	exploringFiles: (n: number) => string;
	exploredFiles: (n: number) => string;
	editingFiles: (n: number) => string;
	editedFiles: (n: number) => string;
	searches: (n: number) => string;
	tools: (n: number) => string;
	/** Separator between summary parts, e.g. ", " / "、". */
	join: string;
	thinking: string;
	thoughtFor: (duration: string) => string;
	thoughtBriefly: string;
	planning: string;
	formatDuration: (ms: number) => string;
};

export type ProcessSummaryView = {
	/** Foldable header text (no +/-). */
	summary: string;
	/** Whether header has expandable detail steps. */
	expandable: boolean;
};

export function formatTurnProcessView(
	stats: TurnProcessStats,
	labels: ProcessSummaryLabels,
	stepCount: number,
): ProcessSummaryView {
	const parts: string[] = [];
	const live = stats.live;

		if (stats.primary === "thought" || (
		stats.editedFiles === 0 &&
		stats.exploredFiles === 0 &&
		stats.searches === 0 &&
		stats.otherTools === 0 &&
		stats.hasThinking
	)) {
		if (live && stats.thinkingStreaming) {
			return { summary: labels.thinking, expandable: false };
		}
		if (stats.thinkingDurationMs != null && stats.thinkingDurationMs >= 2500) {
			return {
				summary: labels.thoughtFor(
					labels.formatDuration(stats.thinkingDurationMs),
				),
				expandable: stepCount > 0,
			};
		}
		return {
			summary: labels.thoughtBriefly,
			expandable: stepCount > 0,
		};
	}

	if (stats.primary === "edit" || (stats.editedFiles > 0 && stats.exploredFiles === 0 && stats.searches === 0)) {
		parts.push(
			live
				? labels.editingFiles(stats.editedFiles)
				: labels.editedFiles(stats.editedFiles),
		);
	} else if (stats.primary === "explore") {
		if (stats.exploredFiles > 0) {
			parts.push(
				live
					? labels.exploringFiles(stats.exploredFiles)
					: labels.exploredFiles(stats.exploredFiles),
			);
		}
		if (stats.searches > 0) parts.push(labels.searches(stats.searches));
		if (stats.otherTools > 0) parts.push(labels.tools(stats.otherTools));
	} else {
		// mixed
		if (stats.editedFiles > 0) {
			parts.push(
				live
					? labels.editingFiles(stats.editedFiles)
					: labels.editedFiles(stats.editedFiles),
			);
		}
		if (stats.exploredFiles > 0) {
			parts.push(
				live
					? labels.exploringFiles(stats.exploredFiles)
					: labels.exploredFiles(stats.exploredFiles),
			);
		}
		if (stats.searches > 0) parts.push(labels.searches(stats.searches));
		if (stats.otherTools > 0) parts.push(labels.tools(stats.otherTools));
	}

	if (parts.length === 0 && live) {
		return { summary: labels.thinking, expandable: false };
	}

	const summary = parts.join(labels.join);
	return {
		summary: summary.charAt(0).toUpperCase() + summary.slice(1),
		expandable: stepCount > 0,
	};
}

/** @deprecated */
export function formatTurnProcessSummary(
	stats: TurnProcessStats,
	labels: ProcessSummaryLabels,
): string {
	return formatTurnProcessView(stats, labels, 0).summary;
}
