import fs from "node:fs";
import path from "node:path";
import { resolveWorkspacePath } from "../shared/path-sandbox";
import {
	rankFuzzyPathEntries,
	scoreFuzzyPathQuery,
} from "../shared/fuzzy-path";
import {
	withoutAsar,
	workspaceEntryKind,
	workspaceExists,
} from "./workspace-fs";

const SKIP = new Set([
	"node_modules",
	"dist",
	"out",
	"release",
	"coverage",
	"__pycache__",
]);

export type WorkspaceDirEntry = {
	name: string;
	/** Relative path using `/` separators */
	path: string;
	kind: "file" | "dir";
};

function toRel(relative: string, name: string): string {
	const rel = relative ? `${relative.replace(/\\/g, "/")}/${name}` : name;
	return rel.replace(/\\/g, "/");
}

/**
 * 目录项类型。readdir 的 Dirent 在多数文件系统已经给出类型，不必逐项 stat；
 * 符号链接与未知类型（部分网络盘返回 DT_UNKNOWN）仍然回退到 stat。
 */
function direntKind(dirAbs: string, dirent: fs.Dirent): "file" | "dir" | "none" {
	if (dirent.isDirectory()) return "dir";
	if (dirent.isFile()) return "file";
	return workspaceEntryKind(path.join(dirAbs, dirent.name));
}

export function listWorkspaceDir(
	root: string,
	relative = "",
): WorkspaceDirEntry[] {
	const abs = relative
		? resolveWorkspacePath(root, relative)
		: path.resolve(root);
	if (workspaceEntryKind(abs) !== "dir") {
		return [];
	}
	const dirents = withoutAsar(() =>
		fs.readdirSync(abs, { withFileTypes: true }),
	);
	const entries: WorkspaceDirEntry[] = [];
	for (const dirent of dirents) {
		const name = dirent.name;
		if (SKIP.has(name) || name === "." || name === "..") continue;
		const kind = direntKind(abs, dirent);
		if (kind === "none") continue;
		entries.push({ name, path: toRel(relative, name), kind });
	}
	entries.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
	return entries;
}

function assertSafeName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Name cannot be empty");
	if (
		trimmed.includes("/") ||
		trimmed.includes("\\") ||
		trimmed.includes("..")
	) {
		throw new Error("Name cannot contain path separators");
	}
	return trimmed;
}

export function createWorkspaceFile(
	root: string,
	relativeDir: string,
	name: string,
): string {
	const safe = assertSafeName(name);
	const dirAbs = relativeDir
		? resolveWorkspacePath(root, relativeDir)
		: path.resolve(root);
	fs.mkdirSync(dirAbs, { recursive: true });
	const abs = path.join(dirAbs, safe);
	resolveWorkspacePath(root, path.relative(root, abs));
	if (workspaceExists(abs))
		throw new Error("A file with that name already exists");
	withoutAsar(() => fs.writeFileSync(abs, "", "utf8"));
	return toRel(relativeDir, safe);
}

export function createWorkspaceDir(
	root: string,
	relativeDir: string,
	name: string,
): string {
	const safe = assertSafeName(name);
	const dirAbs = relativeDir
		? resolveWorkspacePath(root, relativeDir)
		: path.resolve(root);
	fs.mkdirSync(dirAbs, { recursive: true });
	const abs = path.join(dirAbs, safe);
	resolveWorkspacePath(root, path.relative(root, abs));
	if (workspaceExists(abs))
		throw new Error("A folder with that name already exists");
	withoutAsar(() => fs.mkdirSync(abs));
	return toRel(relativeDir, safe);
}

/** 目标名与原名只有大小写差异时（Windows/macOS 大小写不敏感），确认指向同一文件。 */
function isCaseOnlySameEntry(abs: string, nextAbs: string): boolean {
	if (
		path.basename(abs).toLowerCase() !== path.basename(nextAbs).toLowerCase()
	) {
		return false;
	}
	try {
		const from = fs.statSync(abs);
		const to = fs.statSync(nextAbs);
		return from.dev === to.dev && from.ino === to.ino;
	} catch {
		return false;
	}
}

export function renameWorkspaceEntry(
	root: string,
	relativePath: string,
	newName: string,
): string {
	const safe = assertSafeName(newName);
	const abs = resolveWorkspacePath(root, relativePath);
	const parentRel = path.dirname(relativePath.replace(/\\/g, "/"));
	const parentKey = parentRel === "." ? "" : parentRel;
	if (safe === path.basename(abs)) return toRel(parentKey, safe);
	const nextAbs = path.join(path.dirname(abs), safe);
	resolveWorkspacePath(root, path.relative(root, nextAbs));
	if (workspaceExists(nextAbs) && !isCaseOnlySameEntry(abs, nextAbs)) {
		throw new Error("That name already exists");
	}
	withoutAsar(() => fs.renameSync(abs, nextAbs));
	return toRel(parentKey, safe);
}

/** Move a file/folder into another directory (same basename). */
export function moveWorkspaceEntry(
	root: string,
	relativePath: string,
	destRelativeDir: string,
): string {
	const abs = resolveWorkspacePath(root, relativePath);
	const base = path.basename(abs);
	const fromNorm = relativePath.replace(/\\/g, "/");
	const destNorm = (destRelativeDir || "")
		.replace(/\\/g, "/")
		.replace(/\/+$/, "");
	if (destNorm === fromNorm || destNorm.startsWith(`${fromNorm}/`)) {
		throw new Error("Cannot move into itself or a subdirectory");
	}
	const destDirAbs = destNorm
		? resolveWorkspacePath(root, destNorm)
		: path.resolve(root);
	if (workspaceEntryKind(destDirAbs) !== "dir") {
		throw new Error("Destination folder does not exist");
	}
	const nextAbs = path.join(destDirAbs, base);
	resolveWorkspacePath(root, path.relative(root, nextAbs));
	if (path.resolve(abs) === path.resolve(nextAbs)) return fromNorm;
	if (workspaceExists(nextAbs))
		throw new Error("An item with that name already exists there");
	withoutAsar(() => fs.renameSync(abs, nextAbs));
	return toRel(destNorm, base);
}

export function deleteWorkspaceEntry(root: string, relativePath: string): void {
	const abs = resolveWorkspacePath(root, relativePath);
	withoutAsar(() => fs.rmSync(abs, { recursive: true, force: false }));
}

const SEARCH_SKIP = new Set([
	...SKIP,
	".git",
	".hg",
	".svn",
	".next",
	".nuxt",
	".turbo",
	".cache",
	"build",
	"vendor",
]);

export type WorkspaceSearchOptions = {
	/** Max results to return (default 80). */
	limit?: number;
};

/** Absolute / drive-letter path queries (e.g. pasted C:\... or /home/...). */
function isAbsoluteLikeQuery(q: string): boolean {
	return /^[a-zA-Z]:[\/]/.test(q) || q.startsWith("/");
}

/**
 * Search an absolute path (outside/inside the workspace). Resolves the
 * deepest existing directory of the query, lists its children and fuzzy
 * matches the trailing part. Entries carry absolute `path` values so they
 * can be attached directly.
 */
function searchAbsolutePath(query: string, limit: number): WorkspaceDirEntry[] {
	const q = query.replace(/\\/g, "/");
	let probe = q;
	let dir = "";
	while (probe.length > 0) {
		const kind = workspaceEntryKind(probe);
		if (kind !== "none") {
			dir = kind === "dir" ? probe : path.dirname(probe);
			break;
		}
		const next = path.dirname(probe);
		if (next === probe) return [];
		probe = next;
	}
	if (!dir || !workspaceExists(dir)) return [];
	const entries = listWorkspaceDir(dir, "").map((e) => ({
		name: e.name,
		path: `${dir.replace(/\\/g, "/")}/${e.name}`,
		kind: e.kind,
	}));
	const trailing = q.slice(dir.length).replace(/^[/\\]+/, "");
	const ranked = trailing ? rankFuzzyPathEntries(trailing, entries) : entries;
	return ranked.slice(0, limit);
}

/**
 * Walk the workspace and return entries matching `query` with fuzzy
 * ranking (basename / camelCase / multi-token). Empty query lists the root.
 */
export function searchWorkspaceFiles(
	root: string,
	query: string,
	options: WorkspaceSearchOptions = {},
): WorkspaceDirEntry[] {
	const q = query.trim().replace(/\\/g, "/");
	if (!q) return listWorkspaceDir(root, "");
	const limit = Math.max(1, Math.min(options.limit ?? 80, 200));
	if (isAbsoluteLikeQuery(q)) return searchAbsolutePath(q, limit);
	const rootAbs = path.resolve(root);
	const candidates: WorkspaceDirEntry[] = [];
	const maxCandidates = Math.max(limit * 8, 400);

	const walk = (relative: string, depth: number): void => {
		if (candidates.length >= maxCandidates) return;
		// Soft depth cap keeps large monorepos responsive for the picker.
		if (depth > 12) return;
		const abs = relative ? path.join(rootAbs, relative) : rootAbs;
		let names: string[];
		try {
			names = fs.readdirSync(abs);
		} catch {
			return;
		}
		for (const name of names) {
			// Skip heavy/vcs dirs (node_modules, .git, .cache, …). Dotfiles are
			// searchable — only specific ignored dirs are excluded.
			if (SEARCH_SKIP.has(name) || name === "." || name === "..") continue;
			const childRel = toRel(relative, name);
			const childAbs = path.join(abs, name);
			const kind = workspaceEntryKind(childAbs);
			if (kind === "none") continue;
			const entry: WorkspaceDirEntry = { name, path: childRel, kind };
			if (scoreFuzzyPathQuery(q, name, childRel) != null) {
				candidates.push(entry);
			}
			if (kind === "dir") walk(childRel, depth + 1);
			if (candidates.length >= maxCandidates) return;
		}
	};

	walk("", 0);
	return rankFuzzyPathEntries(q, candidates).slice(0, limit);
}
