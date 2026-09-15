import fs from "node:fs";
import path from "node:path";
import { ipcMain, webContents } from "electron";
import { IpcChannels } from "../shared/protocol";

/**
 * 工作区外预览文件的订阅：监听文件所在目录，目录有变化就通知订阅窗口，
 * 由渲染端读盘比对决定是否刷新（临时文件 + rename 的原子写同样能捕获）。
 */
type DirWatch = {
	watcher: fs.FSWatcher;
	/** webContents.id → 该窗口订阅的文件绝对路径（已归一化）。 */
	owners: Map<number, Set<string>>;
	timer: ReturnType<typeof setTimeout> | null;
};

const dirWatches = new Map<string, DirWatch>();
const trackedWebContents = new Set<number>();

function pathKey(p: string): string {
	const abs = path.resolve(p);
	return process.platform === "win32" ? abs.toLowerCase() : abs;
}

function dirKeyOf(filePath: string): string {
	return pathKey(path.dirname(path.resolve(filePath)));
}

function closeDirWatch(dirKey: string): void {
	const watch = dirWatches.get(dirKey);
	if (!watch) return;
	dirWatches.delete(dirKey);
	if (watch.timer) clearTimeout(watch.timer);
	try {
		watch.watcher.close();
	} catch {
		// ignore
	}
}

function flushDir(dirKey: string): void {
	const watch = dirWatches.get(dirKey);
	if (!watch) return;
	watch.timer = null;
	for (const [id, files] of watch.owners) {
		if (!files.size) continue;
		const wc = webContents.fromId(id);
		if (!wc || wc.isDestroyed()) continue;
		wc.send(IpcChannels.preview.changed, { paths: [...files] });
	}
}

function openDirWatch(dirKey: string, dir: string): boolean {
	try {
		const watcher = fs.watch(dir, { persistent: false }, () => {
			const watch = dirWatches.get(dirKey);
			if (!watch) return;
			if (watch.timer) clearTimeout(watch.timer);
			// 与 fs-watch-host 一致：合并同一批写入事件
			watch.timer = setTimeout(() => flushDir(dirKey), 150);
		});
		watcher.on("error", () => closeDirWatch(dirKey));
		dirWatches.set(dirKey, { watcher, owners: new Map(), timer: null });
		return true;
	} catch {
		return false;
	}
}

function trackWebContents(id: number): void {
	if (trackedWebContents.has(id)) return;
	const wc = webContents.fromId(id);
	if (!wc) return;
	trackedWebContents.add(id);
	wc.once("destroyed", () => {
		trackedWebContents.delete(id);
		for (const [dirKey, watch] of [...dirWatches]) {
			watch.owners.delete(id);
			if (!watch.owners.size) closeDirWatch(dirKey);
		}
	});
}

function subscribe(id: number, filePath: string): void {
	const dirKey = dirKeyOf(filePath);
	if (!dirWatches.has(dirKey) && !openDirWatch(dirKey, path.dirname(path.resolve(filePath)))) {
		return;
	}
	const watch = dirWatches.get(dirKey);
	if (!watch) return;
	let files = watch.owners.get(id);
	if (!files) {
		files = new Set();
		watch.owners.set(id, files);
		trackWebContents(id);
	}
	files.add(pathKey(filePath));
}

function unsubscribe(id: number, filePath: string): void {
	const dirKey = dirKeyOf(filePath);
	const watch = dirWatches.get(dirKey);
	if (!watch) return;
	const files = watch.owners.get(id);
	if (!files) return;
	files.delete(pathKey(filePath));
	if (files.size) return;
	watch.owners.delete(id);
	if (!watch.owners.size) closeDirWatch(dirKey);
}

export function registerPreviewWatchIpc(): void {
	ipcMain.handle(IpcChannels.preview.watch, (event, filePath: string) => {
		if (typeof filePath !== "string" || !filePath) return { ok: false as const };
		subscribe(event.sender.id, filePath);
		return { ok: true as const };
	});

	ipcMain.handle(IpcChannels.preview.unwatch, (event, filePath: string) => {
		if (typeof filePath !== "string" || !filePath) return { ok: false as const };
		unsubscribe(event.sender.id, filePath);
		return { ok: true as const };
	});
}
