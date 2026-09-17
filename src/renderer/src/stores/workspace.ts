import { defineStore } from "pinia";
import { ref, watch } from "vue";
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

export const useWorkspaceStore = defineStore("workspace", () => {
	const root = ref<string | null>(null);
	const recent = ref<string[]>([]);
	/**
	 * True once the current `root` is ready for session hydrate / worker spawn.
	 */
	const sessionsReady = ref(false);

	/**
	 * Watcher lifecycle is owned by main (workspace-ipc).
	 * On switch we still ask main to re-sync, and drop old-workspace preview tabs
	 * so we only care about files under the current root.
	 */
	function onRootChanged(next: string | null, prev: string | null): void {
		if (next === prev) return;
		const tabs = useRightTabsStore();
		tabs.switchWorkspace(prev, next);
		if (next) void window.api.fs.watch(next);
		else void window.api.fs.unwatch();
	}

	watch(root, (next, prev) => {
		onRootChanged(next, prev ?? null);
	});

	watch(
		() => {
			const tabs = useRightTabsStore();
			return [tabs.tabs, tabs.activeId] as const;
		},
		() => {
			useRightTabsStore().persistTabs(root.value);
		},
		{ deep: true },
	);

	async function commitWorkspace(next: string | null): Promise<string | null> {
		sessionsReady.value = false;
		root.value = next;
		sessionsReady.value = true;
		return root.value;
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
		const previous = root.value;
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
		recent.value = sanitizeRoots(await window.api.workspace.listRecent());
		return recent.value;
	}

	/**
	 * Instant Desktop-only list, then refresh with Pi discovery in the background.
	 * Keeps startup / first paint snappy when ~/.pi/agent/sessions is large.
	 */
	async function listRecentFast(): Promise<string[]> {
		recent.value = sanitizeRoots(await window.api.workspace.listRecentDesktop());
		void listRecent().catch(() => {
			/* background merge best-effort */
		});
		return recent.value;
	}

	async function applyWorkspaceSwitch(next: {
		root: string | null;
		recent: string[];
	}): Promise<void> {
		recent.value = sanitizeRoots(next.recent);
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
		recent.value = sanitizeRoots(await window.api.workspace.reorderRecent(order));
		return recent.value;
	}

	async function revealInFolder(workspaceRoot: string): Promise<void> {
		await window.api.workspace.revealInFolder(workspaceRoot);
	}

	return {
		root,
		recent,
		sessionsReady,
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
	};
});
