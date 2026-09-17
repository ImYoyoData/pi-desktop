/**
 * Line-level diff counters (git-numstat style counts) for comparing the
 * state of a file before and after a whole session of edits.
 *
 * Pure and dependency-free so main (checkpoint-host) and unit tests share it.
 */

export type LineDiffCounts = {
	additions: number;
	deletions: number;
};

/** Split text into lines; a single trailing newline does not add a line. */
function splitLines(text: string): string[] {
	if (!text) return [];
	let s = text.replace(/\r\n/g, "\n");
	if (s.endsWith("\n")) s = s.slice(0, -1);
	if (s === "") return [];
	return s.split("\n");
}

/**
 * LCS cell cap — past this the interior is treated as a full rewrite
 * (git reports complete rewrites the same way).
 */
const MAX_LCS_CELLS = 4_000_000;

/** Alignment-based count over the trimmed interiors via an LCS DP table. */
function lcsCount(a: string[], b: string[]): LineDiffCounts {
	const m = a.length;
	const n = b.length;
	const width = n + 1;
	const dp = new Uint32Array((m + 1) * width);
	for (let i = 1; i <= m; i += 1) {
		const row = i * width;
		const prev = row - width;
		const ai = a[i - 1];
		for (let j = 1; j <= n; j += 1) {
			const cell = row + j;
			if (ai === b[j - 1]) {
				dp[cell] = dp[prev + j - 1] + 1;
			} else {
				const up = dp[prev + j];
				const left = dp[cell - 1];
				dp[cell] = up >= left ? up : left;
			}
		}
	}

	let i = m;
	let j = n;
	let additions = 0;
	let deletions = 0;
	while (i > 0 && j > 0) {
		if (a[i - 1] === b[j - 1]) {
			i -= 1;
			j -= 1;
		} else if (dp[(i - 1) * width + j] >= dp[i * width + j - 1]) {
			deletions += 1;
			i -= 1;
		} else {
			additions += 1;
			j -= 1;
		}
	}
	return { additions: additions + j, deletions: deletions + i };
}

/** Count added/removed lines between two file states (before → after). */
export function countLineDiff(before: string, after: string): LineDiffCounts {
	const a = splitLines(before);
	const b = splitLines(after);

	// Trim the common prefix / suffix so the LCS interior stays small.
	let start = 0;
	while (start < a.length && start < b.length && a[start] === b[start]) {
		start += 1;
	}
	let end = 0;
	while (
		end < a.length - start &&
		end < b.length - start &&
		a[a.length - 1 - end] === b[b.length - 1 - end]
	) {
		end += 1;
	}

	const midA = a.slice(start, a.length - end);
	const midB = b.slice(start, b.length - end);
	if (midA.length === 0 && midB.length === 0) {
		return { additions: 0, deletions: 0 };
	}
	if (midA.length === 0) {
		return { additions: midB.length, deletions: 0 };
	}
	if (midB.length === 0) {
		return { additions: 0, deletions: midA.length };
	}
	if (midA.length * midB.length > MAX_LCS_CELLS) {
		return { additions: midB.length, deletions: midA.length };
	}
	return lcsCount(midA, midB);
}
