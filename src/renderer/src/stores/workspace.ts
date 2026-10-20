import { create } from "zustand";
import type { WorkspaceGroups } from "../../../shared/protocol";
import { useRightTabsStore } from "@renderer/stores/right-tabs";

/**
 * Blank roots resolve to the app's own directory further down the line and the
 * sidebar renders `basename(root)`, so they surface as an extra nameless
 * workspace. Never let one reach the UI.
 */
function sanitizeRoots(list: unknown): string[] {
	return Array.isArray(list)
		? list.filter(
				(entry): entry is string =>
					typeof entry === "string" && entry.trim().length > 0,
			)
		: [];
}

type WorkspaceBase = {
	root: string | null;
	recent: string[];
	/** 绝对路径 → 用户自定义显示名。 */
	aliases: Record<string, string>;
	/** 自定义分类名（顺序即菜单顺序）；未归类的工作区归入内置“默认”。 */
	groups: string[];
	/** 绝对路径 → 分类名。 */
	groupOf: Record<string, string>;
	/** 已归档的会话 id（从侧栏隐藏，可恢复）。 */
	archivedSessions: string[];
	/**
	 * True once the current `root` is ready for session hydrate / worker spawn.
	 */
	sessionsReady: boolean;
};

export type WorkspaceState = WorkspaceBase & {
	getWorkspace: () => Promise<string | null>;
	openWorkspace: () => Promise<string | null>;
	openWorkspacePath: (workspaceRoot: string) => Promise<string | null>;
	clearWorkspace: () => Promise<null>;
	listRecent: () => Promise<string[]>;
	listRecentFast: () => Promise<string[]>;
	removeRecent: (workspaceRoot: string) => Promise<void>;
	purgeWorkspace: (workspaceRoot: string) => Promise<void>;
	reorderRecent: (order: string[]) => Promise<string[]>;
	revealInFolder: (workspaceRoot: string) => Promise<void>;
	refreshAliases: () => Promise<void>;
	renameWorkspace: (workspaceRoot: string, name: string | null) => Promise<void>;
	relocateWorkspace: (workspaceRoot: string) => Promise<string | null>;
	refreshGroups: () => Promise<void>;
	addGroup: (name: string) => Promise<void>;
	renameGroup: (from: string, to: string) => Promise<void>;
	removeGroup: (name: string) => Promise<void>;
	setGroupOf: (workspaceRoot: string, group: string | null) => Promise<void>;
	refreshArchivedSessions: () => Promise<void>;
	setArchivedSessions: (ids: string[]) => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => {
	/**
	 * Watcher lifecycle is owned by main (workspace-ipc).
	 * On switch we still ask main to re-sync, and drop old-workspace preview tabs
	 * so we only care about files under the current root.
	 */
	function onRootChanged(next: string | null, prev: string | null): void {
		if (next === prev) return;
		useRightTabsStore.getState().switchWorkspace(prev, next);
		if (next) void window.api.fs.watch(next);
		else void window.api.fs.unwatch();
	}

	function commitWorkspace(next: string | null): string | null {
		const prev = get().root;
		set({ sessionsReady: false, root: next });
		onRootChanged(next, prev);
		set({ sessionsReady: true });
		return get().root;
	}

	async function clearWorkspace(): Promise<null> {
		await window.api.workspace.clear();
		await commitWorkspace(null);
		return null;
	}

	async function getWorkspace(): Promise<string | null> {
		const next = await window.api.workspace.get();
		if (!next) return commitWorkspace(null);
		return commitWorkspace(next);
	}

	async function openWorkspace(): Promise<string | null> {
		const previous = get().root;
		const picked = await window.api.workspace.pick();
		await listRecent();
		if (!picked) return previous;
		const next = await window.api.workspace.openPath(picked);
		await listRecent();
		return commitWorkspace(next);
	}

	async function openWorkspacePath(workspaceRoot: string): Promise<string | null> {
		const next = await window.api.workspace.openPath(workspaceRoot);
		const committed = commitWorkspace(next);
		// 最近工作区列表只喂侧栏，列表刷新不能拖住工作区切换。
		void listRecentFast().catch(() => {});
		return committed;
	}

	/**
	 * Full recent list (Desktop + Pi-discovered). Prefer listRecentFast on boot.
	 */
	async function listRecent(): Promise<string[]> {
		const rows = sanitizeRoots(await window.api.workspace.listRecent());
		set({ recent: rows });
		return rows;
	}

	/**
	 * Instant Desktop-only list, then refresh with Pi discovery in the background.
	 * Keeps startup / first paint snappy when ~/.pi/agent/sessions is large.
	 */
	async function listRecentFast(): Promise<string[]> {
		const rows = sanitizeRoots(await window.api.workspace.listRecentDesktop());
		set({ recent: rows });
		void listRecent().catch(() => {
			/* background merge best-effort */
		});
		return rows;
	}

	async function applyWorkspaceSwitch(next: {
		root: string | null;
		recent: string[];
	}): Promise<void> {
		set({ recent: sanitizeRoots(next.recent) });
		await commitWorkspace(next.root);
	}

	async function removeRecent(workspaceRoot: string): Promise<void> {
		const next = await window.api.workspace.removeRecent(workspaceRoot);
		await applyWorkspaceSwitch(next);
	}

	/**
	 * Remove workspace from Pi Desktop: drop config + delete Pi sessions.
	 * Does not delete the project directory on disk.
	 */
	async function purgeWorkspace(workspaceRoot: string): Promise<void> {
		const next = await window.api.workspace.purge(workspaceRoot);
		await applyWorkspaceSwitch(next);
	}

	async function reorderRecent(order: string[]): Promise<string[]> {
		const rows = sanitizeRoots(await window.api.workspace.reorderRecent(order));
		set({ recent: rows });
		return rows;
	}

	async function revealInFolder(workspaceRoot: string): Promise<void> {
		await window.api.workspace.revealInFolder(workspaceRoot);
	}

	async function refreshAliases(): Promise<void> {
		set({ aliases: await window.api.workspace.listAliases() });
	}

	/** 重命名工作区显示名（磁盘目录不变）；name 为空即清除。 */
	async function renameWorkspace(
		workspaceRoot: string,
		name: string | null,
	): Promise<void> {
		set({ aliases: await window.api.workspace.setAlias(workspaceRoot, name) });
	}

	/** 重新定位：选新目录接管该工作区，Pi 会话一起迁过去。取消时返回 null。 */
	async function relocateWorkspace(
		workspaceRoot: string,
	): Promise<string | null> {
		const picked = await window.api.workspace.pick();
		if (!picked) return null;
		const next = await window.api.workspace.relocate(workspaceRoot, picked);
		set({ aliases: next.aliases });
		await applyWorkspaceSwitch(next);
		return next.root;
	}

	function applyGroups(next: WorkspaceGroups): void {
		set({ groups: next.groups, groupOf: next.groupOf });
	}

	async function refreshGroups(): Promise<void> {
		applyGroups(await window.api.workspace.listGroups());
	}

	async function addGroup(name: string): Promise<void> {
		applyGroups(await window.api.workspace.addGroup(name));
	}

	async function renameGroup(from: string, to: string): Promise<void> {
		applyGroups(await window.api.workspace.renameGroup(from, to));
	}

	async function removeGroup(name: string): Promise<void> {
		applyGroups(await window.api.workspace.removeGroup(name));
	}

	/** 把工作区归入分类；group 为空即回到内置“默认”。 */
	async function setGroupOf(
		workspaceRoot: string,
		group: string | null,
	): Promise<void> {
		applyGroups(await window.api.workspace.setGroupOf(workspaceRoot, group));
	}

	async function refreshArchivedSessions(): Promise<void> {
		set({ archivedSessions: await window.api.workspace.listArchivedSessions() });
	}

	async function setArchivedSessions(ids: string[]): Promise<void> {
		set({ archivedSessions: ids });
	}

	return {
		root: null,
		recent: [],
		aliases: {},
		groups: [],
		groupOf: {},
		archivedSessions: [],
		sessionsReady: false,
		getWorkspace,
		openWorkspace,
		openWorkspacePath,
		clearWorkspace,
		listRecent,
		listRecentFast,
		removeRecent,
		purgeWorkspace,
		reorderRecent,
		revealInFolder,
		refreshAliases,
		renameWorkspace,
		relocateWorkspace,
		refreshGroups,
		addGroup,
		renameGroup,
		removeGroup,
		setGroupOf,
		refreshArchivedSessions,
		setArchivedSessions,
	};
});

useRightTabsStore.subscribe((state, prev) => {
	if (state.tabs === prev.tabs && state.activeId === prev.activeId) return;
	useRightTabsStore.getState().persistTabs(useWorkspaceStore.getState().root);
});
