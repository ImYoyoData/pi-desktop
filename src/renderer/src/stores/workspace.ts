import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useRightTabsStore } from "@renderer/stores/right-tabs";

export type TrustPromptChoice = "trust" | "dont_trust";

function normalizeCwd(cwd: string): string {
	return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export const useWorkspaceStore = defineStore("workspace", () => {
	const root = ref<string | null>(null);
	const recent = ref<string[]>([]);
	/** Workspaces the user closed (hidden from the main list, re-openable). */
	const closed = ref<string[]>([]);
	/** Absolute path awaiting Trust / Don't trust (must trust to open). */
	const pendingTrustPrompt = ref<string | null>(null);
	/**
	 * True once trust is resolved for the current `root`.
	 * Session hydrate / worker spawn should wait on this.
	 */
	const sessionsReady = ref(false);

	const trustPromptWaiters = new Map<string, Promise<boolean>>();
	let trustAnswerResolve: ((accepted: boolean) => void) | null = null;

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

	/** Returns true only when the user trusts (or already trusted) the path. */
	async function requestTrustToOpen(cwd: string): Promise<boolean> {
		const key = normalizeCwd(cwd);
		const inflight = trustPromptWaiters.get(key);
		if (inflight) return inflight;

		const state = await window.api.trust.get(cwd);
		if (state.decision === true) {
			pendingTrustPrompt.value = null;
			return true;
		}

		const wait = new Promise<boolean>((resolve) => {
			pendingTrustPrompt.value = cwd;
			trustAnswerResolve = resolve;
		}).finally(() => {
			trustPromptWaiters.delete(key);
		});
		trustPromptWaiters.set(key, wait);
		return wait;
	}

	async function answerTrustPrompt(choice: TrustPromptChoice): Promise<void> {
		const cwd = pendingTrustPrompt.value;
		if (!cwd) return;

		if (choice === "trust") {
			await window.api.trust.set(cwd, true);
			pendingTrustPrompt.value = null;
			const resolve = trustAnswerResolve;
			trustAnswerResolve = null;
			resolve?.(true);
			return;
		}

		await window.api.trust.set(cwd, false);
		pendingTrustPrompt.value = null;
		const resolve = trustAnswerResolve;
		trustAnswerResolve = null;
		resolve?.(false);
	}

	async function commitWorkspace(next: string | null): Promise<string | null> {
		sessionsReady.value = false;
		root.value = next;
		if (next) {
			sessionsReady.value = true;
		} else {
			sessionsReady.value = true;
		}
		return root.value;
	}

	/** Close the active workspace (e.g. after untrust from settings). */
	async function clearWorkspace(): Promise<null> {
		await window.api.workspace.clear();
		pendingTrustPrompt.value = null;
		return commitWorkspace(null);
	}

	async function getWorkspace(): Promise<string | null> {
		const next = await window.api.workspace.get();
		if (!next) {
			return commitWorkspace(null);
		}
		const accepted = await requestTrustToOpen(next);
		if (!accepted) {
			await window.api.workspace.clear();
			return commitWorkspace(null);
		}
		return commitWorkspace(next);
	}

	async function openWorkspace(): Promise<string | null> {
		const previous = root.value;
		const picked = await window.api.workspace.pick();
		await listRecent();
		if (!picked) return previous;
		const accepted = await requestTrustToOpen(picked);
		if (!accepted) return previous;
		const next = await window.api.workspace.openPath(picked);
		await listRecent();
		return commitWorkspace(next);
	}

	async function openWorkspacePath(
		workspaceRoot: string,
	): Promise<string | null> {
		const previous = root.value;
		const accepted = await requestTrustToOpen(workspaceRoot);
		if (!accepted) return previous;
		const next = await window.api.workspace.openPath(workspaceRoot);
		await listRecent();
		return commitWorkspace(next);
	}

	async function listRecent(): Promise<string[]> {
		recent.value = await window.api.workspace.listRecent();
		return recent.value;
	}

	async function listClosed(): Promise<string[]> {
		closed.value = await window.api.workspace.listClosed();
		return closed.value;
	}

	async function removeRecent(workspaceRoot: string): Promise<void> {
		const next = await window.api.workspace.removeRecent(workspaceRoot);
		recent.value = next.recent;
		if (next.root) {
			const accepted = await requestTrustToOpen(next.root);
			if (!accepted) {
				await window.api.workspace.clear();
				await commitWorkspace(null);
				return;
			}
			await commitWorkspace(next.root);
			return;
		}
		await commitWorkspace(null);
	}

	/** Close a workspace: hide from the main list but keep it re-openable. */
	async function closeWorkspace(workspaceRoot: string): Promise<void> {
		await removeRecent(workspaceRoot);
		await listClosed();
	}

	/** Re-open a closed workspace (moves it back to the main list). */
	async function reopenWorkspace(
		workspaceRoot: string,
	): Promise<string | null> {
		const next = await openWorkspacePath(workspaceRoot);
		await listRecent();
		await listClosed();
		return next;
	}

	async function reorderRecent(order: string[]): Promise<string[]> {
		recent.value = await window.api.workspace.reorderRecent(order);
		return recent.value;
	}

	async function revealInFolder(workspaceRoot: string): Promise<void> {
		await window.api.workspace.revealInFolder(workspaceRoot);
	}

	const trustDialogOpen = computed(() => Boolean(pendingTrustPrompt.value));

	return {
		root,
		recent,
		closed,
		pendingTrustPrompt,
		sessionsReady,
		trustDialogOpen,
		getWorkspace,
		openWorkspace,
		openWorkspacePath,
		clearWorkspace,
		listRecent,
		listClosed,
		removeRecent,
		closeWorkspace,
		reopenWorkspace,
		reorderRecent,
		revealInFolder,
		answerTrustPrompt,
	};
});
