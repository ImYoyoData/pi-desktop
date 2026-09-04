import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { noteCheckpointFsChange } from "./checkpoint-host";

export type FsChangeKind = "add" | "change" | "unlink";

export type FsChangeEvent = {
	path: string;
	kind: FsChangeKind;
};

const IGNORE_DIR_SEGMENTS = new Set([
	"node_modules",
	".git",
	".svn",
	".hg",
	"dist",
	"out",
	".next",
	"coverage",
	"__pycache__",
	".turbo",
	".cache",
]);

/** Exactly one recursive watcher for the active workspace. */
let watcher: fs.FSWatcher | null = null;
let watchedRoot: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<string, FsChangeKind>();

function normalizeRoot(root: string): string {
	return path.resolve(root);
}

function rootsEqual(a: string, b: string): boolean {
	const na = normalizeRoot(a);
	const nb = normalizeRoot(b);
	// Windows and macOS (default APFS) are case-insensitive — fold both.
	return process.platform === "win32" || process.platform === "darwin"
		? na.toLowerCase() === nb.toLowerCase()
		: na === nb;
}

function shouldIgnore(relPosix: string): boolean {
	const parts = relPosix.split("/").filter(Boolean);
	// Ignore heavy dirs entirely (node_modules, build outputs, …).
	for (const p of parts) {
		if (IGNORE_DIR_SEGMENTS.has(p)) {
			// Exception: git index / HEAD changes ARE git-status signals — commit,
			// stage, checkout, branch switches all touch these. Surfacing them lets
			// the Changes panel refresh after git-only operations (a plain `git
			// commit` writes nothing outside .git, so it would otherwise go unseen).
			if (p === ".git") {
				const rel = parts[parts.length - 1];
				if (rel === "index" || rel === "HEAD") return false;
			}
			return true;
		}
	}
	return false;
}

function broadcast(events: FsChangeEvent[]): void {
	if (!events.length || !watchedRoot) return;
	const root = watchedRoot;
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(IpcChannels.fs.changed, {
			root,
			events,
		});
	}
}

function flushPending(): void {
	debounceTimer = null;
	if (!watchedRoot || pending.size === 0) return;
	const events: FsChangeEvent[] = [];
	for (const [rel, kind] of pending) {
		events.push({ path: rel, kind });
	}
	pending.clear();
	broadcast(events);
}

/** Flush debounced events now (e.g. before finishing a turn checkpoint). */
export function flushPendingFsWatch(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	flushPending();
}

function queueChange(relPosix: string, kind: FsChangeKind): void {
	if (shouldIgnore(relPosix)) return;
	// Checkpoint must see touches immediately — debounce only coalesces UI broadcasts.
	if (watchedRoot) {
		noteCheckpointFsChange(watchedRoot, relPosix, kind);
	}
	const prev = pending.get(relPosix);
	if (prev === "unlink" && kind !== "unlink") {
		pending.set(relPosix, kind === "add" ? "add" : "change");
	} else if (kind === "unlink") {
		pending.set(relPosix, "unlink");
	} else if (!prev || prev === "add") {
		pending.set(relPosix, kind);
	} else if (prev !== "unlink") {
		pending.set(relPosix, "change");
	}
	if (debounceTimer) clearTimeout(debounceTimer);
	debounceTimer = setTimeout(flushPending, 180);
}

export function stopWorkspaceWatch(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = null;
	}
	pending.clear();
	if (watcher) {
		try {
			watcher.close();
		} catch {
			// ignore
		}
		watcher = null;
	}
	watchedRoot = null;
}

export function startWorkspaceWatch(root: string): void {
	if (process.env.PI_DESKTOP_NO_WATCH === "1") return;
	const resolved = normalizeRoot(root);
	// Already watching this workspace — keep the single watcher
	if (watchedRoot && rootsEqual(watchedRoot, resolved) && watcher) {
		return;
	}
	// Always drop the previous workspace watcher before attaching a new one
	stopWorkspaceWatch();
	if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
		return;
	}
	watchedRoot = resolved;
	try {
		watcher = fs.watch(resolved, { recursive: true }, (eventType, filename) => {
			// Guard against late events after switch/stop
			if (!filename || !watchedRoot || !rootsEqual(watchedRoot, resolved)) return;
			const rel = filename.toString().split(path.sep).join("/");
			if (!rel || shouldIgnore(rel)) return;
			const abs = path.join(watchedRoot, filename.toString());
			let exists = false;
			try {
				exists = fs.existsSync(abs) && fs.statSync(abs).isFile();
			} catch {
				exists = false;
			}
			if (!exists) {
				const dirExists =
					fs.existsSync(abs) &&
					(() => {
						try {
							return fs.statSync(abs).isDirectory();
						} catch {
							return false;
						}
					})();
				queueChange(rel, dirExists ? "add" : "unlink");
				return;
			}
			queueChange(rel, eventType === "change" ? "change" : "add");
		});
		watcher.on("error", () => {
			stopWorkspaceWatch();
		});
	} catch {
		watchedRoot = null;
		watcher = null;
	}
}

export function getWatchedRoot(): string | null {
	return watchedRoot;
}

export function registerFsWatchIpc(): void {
	// Optional manual control — workspace-ipc owns the normal lifecycle
	ipcMain.handle(IpcChannels.fs.watch, (_event, root: string) => {
		if (!root || typeof root !== "string") {
			stopWorkspaceWatch();
			return { ok: false as const };
		}
		startWorkspaceWatch(root);
		return { ok: true as const, root: getWatchedRoot() };
	});

	ipcMain.handle(IpcChannels.fs.unwatch, () => {
		stopWorkspaceWatch();
		return { ok: true as const };
	});
}
