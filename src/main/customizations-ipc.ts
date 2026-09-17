import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { BrowserWindow, app, ipcMain } from "electron";
import { IpcChannels } from "../shared/protocol";
import { emptyCustomizations, type CustomizationCreateKind, type CustomizationsSnapshot, type McpTestResult, type McpTestTarget } from "../shared/customizations";
import { getWorkspace, listRecentDesktop } from "./workspace-ipc";
import { createAgentFromDraft, createInstructionsFromDraft, saveAgentContent } from "./agent-host";
import { frontmatterText } from "./frontmatter";
import { createCustomization, listCustomizations, setMcpServerEnabled, addMcpServers, ensureMcpConfig, removeMcpServer, readMcpEntry, setCustomizationItemEnabled, removeCustomizationItem } from "./customizations-host";
import { testMcpServer } from "./mcp-test";

/** 快照缓存版本：字段结构变化时递增，旧缓存自然失效。 */
const SNAPSHOT_CACHE_VERSION = 1;

type CachedSnapshot = {
	version: number;
	root: string;
	snapshot: CustomizationsSnapshot;
};

/** 同一工作区的扫描去重：预热与打开设置页并发时只扫一次。 */
const inflightScans = new Map<string, Promise<CustomizationsSnapshot>>();

/** Windows/macOS 路径大小写不敏感，缓存命中按归一化路径判断。 */
function sameRoot(a: string, b: string): boolean {
	return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function cacheFile(root: string): string {
	const key = createHash("sha1")
		.update(path.resolve(root).toLowerCase())
		.digest("hex")
		.slice(0, 16);
	return path.join(app.getPath("userData"), "customizations-cache", `${key}.json`);
}

/** 读取上次扫描的磁盘快照；缺失、损坏或版本不符时返回 null。 */
function readCachedSnapshot(root: string): CustomizationsSnapshot | null {
	try {
		const parsed = JSON.parse(
			fs.readFileSync(cacheFile(root), "utf8"),
		) as CachedSnapshot;
		if (parsed?.version !== SNAPSHOT_CACHE_VERSION) return null;
		if (typeof parsed.root !== "string" || !sameRoot(parsed.root, root)) return null;
		if (!parsed.snapshot) return null;
		return parsed.snapshot;
	} catch {
		return null;
	}
}

/** 原子写入快照缓存；失败只影响下次启动的首次打开速度。 */
function writeCachedSnapshot(snapshot: CustomizationsSnapshot): void {
	const cacheRoot = snapshot.root;
	if (!cacheRoot) return;
	const file = cacheFile(cacheRoot);
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const payload: CachedSnapshot = {
			version: SNAPSHOT_CACHE_VERSION,
			root: cacheRoot,
			snapshot,
		};
		const tmp = `${file}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
		fs.renameSync(tmp, file);
	} catch {
		// 缓存写入失败不影响功能
	}
}

/** 广播最新快照，已打开的设置页据此替换本地数据。 */
function broadcastSnapshot(snapshot: CustomizationsSnapshot): void {
	for (const win of BrowserWindow.getAllWindows()) {
		win.webContents.send(IpcChannels.customizations.updated, snapshot);
	}
}

/** 完整扫描一次并回写缓存 + 广播；同工作区并发调用共享同一次扫描。 */
function scanSnapshot(root: string): Promise<CustomizationsSnapshot> {
	const key = path.resolve(root).toLowerCase();
	const running = inflightScans.get(key);
	if (running) return running;
	const task = listCustomizations(root, listRecentDesktop())
		.then((snapshot) => {
			writeCachedSnapshot(snapshot);
			broadcastSnapshot(snapshot);
			return snapshot;
		})
		.finally(() => {
			inflightScans.delete(key);
		});
	inflightScans.set(key, task);
	return task;
}

export function registerCustomizationsIpc(broker?: {
	notifyWorkersReloadResources: (cwd: string) => Promise<void>;
}): void {
	ipcMain.handle(
		IpcChannels.customizations.list,
		async (_event, cwd?: string, force?: boolean) => {
			const root = cwd || getWorkspace();
			if (!root) return emptyCustomizations(null);
			if (force) return scanSnapshot(root);
			const cached = readCachedSnapshot(root);
			if (!cached) return scanSnapshot(root);
			// 命中缓存即刻返回，后台重扫完成后用 updated 事件推送最新数据。
			void scanSnapshot(root).catch(() => {});
			return cached;
		},
	);

	ipcMain.handle(IpcChannels.customizations.create, (_event, kind: CustomizationCreateKind) =>
		createCustomization(kind),
	);

	ipcMain.handle(
		IpcChannels.customizations.createAgentFromDraft,
		async (_event, content: string, scope: "user" | "project", workspace?: string) => {
			const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
			const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
			const name = frontmatterText(frontmatter.name);
			return createAgentFromDraft(
				content,
				name,
				scope,
				workspace?.trim() || getWorkspace() || undefined,
			);
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.saveAgent,
		async (_event, filePath: string, content: string, renameName?: string, cwd?: string) => {
			const { parseFrontmatter } = await import("@earendil-works/pi-coding-agent");
			const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
			const name = frontmatterText(frontmatter.name);
			return saveAgentContent(
				filePath,
				content,
				name,
				renameName,
				cwd?.trim() || getWorkspace() || undefined,
			);
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.createInstructionsFromDraft,
		async (_event, content: string, scope: "user" | "project", workspace?: string) =>
			createInstructionsFromDraft(
				content,
				scope,
				workspace?.trim() || getWorkspace() || undefined,
			),
	);

	ipcMain.handle(
		IpcChannels.customizations.setMcpEnabled,
		async (_event, name: string, scope: "user" | "project", enabled: boolean, cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			setMcpServerEnabled(name, scope, enabled, root ?? undefined);
			if (root) await broker?.notifyWorkersReloadResources(root);
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.addMcpServers,
		async (_event, scope: "user" | "project", servers: Record<string, unknown>, cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			const result = addMcpServers(scope, servers, root ?? undefined);
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.ensureMcpConfig,
		(_event, scope: "user" | "project", cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			return ensureMcpConfig(scope, root ?? undefined);
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.removeMcpServer,
		async (_event, name: string, scope: "user" | "project", cwd?: string) => {
			const root = cwd || getWorkspace();
			if (scope === "project" && !root) throw new Error("workspace required");
			const result = removeMcpServer(name, scope, root ?? undefined);
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.setItemEnabled,
		async (_event, filePath: string, enabled: boolean, cwd?: string) => {
			const root = cwd || getWorkspace() || undefined;
			const result = setCustomizationItemEnabled(filePath, enabled, root, listRecentDesktop());
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.removeItem,
		async (_event, filePath: string, cwd?: string) => {
			const root = cwd || getWorkspace() || undefined;
			const result = removeCustomizationItem(filePath, root, listRecentDesktop());
			if (root) await broker?.notifyWorkersReloadResources(root);
			return result;
		},
	);

	ipcMain.handle(
		IpcChannels.customizations.testMcpServers,
		async (_event, targets: McpTestTarget[]): Promise<McpTestResult[]> => {
			const results: McpTestResult[] = [];
			for (const target of targets) {
				const entry = readMcpEntry(target.name, target.scope, target.workspace);
				if (!entry) {
					results.push({ ...target, ok: false, error: "server not found", durationMs: 0 });
					continue;
				}
				if (entry.disabled === true) {
					results.push({ ...target, ok: false, error: "disabled", durationMs: 0 });
					continue;
				}
				results.push({ ...target, ...(await testMcpServer(entry)) });
			}
			return results;
		},
	);
}
