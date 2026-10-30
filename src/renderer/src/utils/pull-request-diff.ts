export type DiffFile = {
	path: string;
	previousPath: string | null;
	/** 完整 diff 段落（含 diff --git/---/+++ 头），diffs 解析器需要它。 */
	rawSection: string;
	/** 该文件是否有可显示的文本改动。 */
	hasHunks: boolean;
	additions: number;
	deletions: number;
};

function unquotePath(value: string): string {
	const trimmed = value.replace(/\t$/, "");
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed.slice(1, -1);
	}
}

function sidePath(line: string, prefix: "a/" | "b/"): string | null {
	const target = unquotePath(line.slice(4));
	return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}

function filePathOf(section: string): string | null {
	for (const line of section.split("\n")) {
		if (line.startsWith("+++ ") && line !== "+++ /dev/null") return sidePath(line, "b/");
	}
	for (const line of section.split("\n")) {
		if (line.startsWith("rename to ")) return unquotePath(line.slice("rename to ".length));
	}
	for (const line of section.split("\n")) {
		if (line.startsWith("--- ") && line !== "--- /dev/null") return sidePath(line, "a/");
	}
	return null;
}

function previousPathOf(section: string, path: string): string | null {
	for (const line of section.split("\n")) {
		if (line.startsWith("--- ") && line !== "--- /dev/null") {
			const previous = sidePath(line, "a/");
			if (previous && previous !== path) return previous;
			return null;
		}
	}
	return null;
}

/**
 * 只统计增删行与「有没有文本改动」——逐行明细交给 diffs 自己解析，
 * 大 PR 因此少分配几万个行对象。
 */
function parseSection(section: string, path: string, previousPath: string | null): DiffFile {
	let additions = 0;
	let deletions = 0;
	let hasHunks = false;
	let inHunk = false;
	for (const line of section.split("\n")) {
		if (line.startsWith("@@")) {
			hasHunks = true;
			inHunk = true;
			continue;
		}
		if (!inHunk) continue;
		if (line.startsWith("diff --git ")) break;
		const marker = line[0] ?? " ";
		if (marker === "+") additions += 1;
		else if (marker === "-") deletions += 1;
	}
	return { path, previousPath, rawSection: section, hasHunks, additions, deletions };
}

export function parseUnifiedDiff(patch: string): DiffFile[] {
	if (!patch.trim()) return [];
	return patch
		.split(/^(?=diff --git )/m)
		.filter((section) => section.startsWith("diff --git "))
		.flatMap((section) => {
			const path = filePathOf(section);
			if (!path) return [];
			return [parseSection(section, path, previousPathOf(section, path))];
		});
}
