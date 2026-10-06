export type DiffLineKind = "context" | "added" | "removed" | "meta";

export type DiffLine = {
	kind: DiffLineKind;
	text: string;
	oldNumber: number | null;
	newNumber: number | null;
};

export type DiffHunk = { header: string; lines: DiffLine[] };

export type DiffFile = {
	path: string;
	previousPath: string | null;
	hunks: DiffHunk[];
	additions: number;
	deletions: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

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

function parseSection(section: string, path: string, previousPath: string | null): DiffFile {
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | null = null;
	let oldNumber = 0;
	let newNumber = 0;
	let additions = 0;
	let deletions = 0;
	for (const line of section.split("\n")) {
		const header = HUNK_HEADER.exec(line);
		if (header) {
			current = { header: line, lines: [] };
			hunks.push(current);
			oldNumber = Number(header[1]);
			newNumber = Number(header[2]);
			continue;
		}
		if (!current) continue;
		if (line.startsWith("diff --git ")) break;
		if (line.startsWith("\\")) {
			current.lines.push({ kind: "meta", text: line, oldNumber: null, newNumber: null });
			continue;
		}
		const marker = line[0] ?? " ";
		const text = line.slice(1);
		if (marker === "+") {
			current.lines.push({ kind: "added", text, oldNumber: null, newNumber });
			newNumber += 1;
			additions += 1;
			continue;
		}
		if (marker === "-") {
			current.lines.push({ kind: "removed", text, oldNumber, newNumber: null });
			oldNumber += 1;
			deletions += 1;
			continue;
		}
		if (marker === " " || line === "") {
			current.lines.push({ kind: "context", text, oldNumber, newNumber });
			oldNumber += 1;
			newNumber += 1;
		}
	}
	return { path, previousPath, hunks, additions, deletions };
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
