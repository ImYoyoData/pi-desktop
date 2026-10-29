/**
 * 共享状态同步：桌面端与浏览器预览页的唯一同步入口。
 *
 * 机制：任何一端改了共享状态 → 主进程广播一条 state:changed → 这里统一收到，
 * 先刷新本地偏好缓存，再让各域「重新读取并应用」。
 *
 * 新增要同步的状态，只需要在这里加一条规则；域内怎么应用由域自己提供
 * （store 的 refreshFromPrefs / 组件的 registerStateApplier）。
 */

import type { StateChange } from "../../../shared/state-sync";
import { REMEMBER_WINDOW_SIZE_PREF } from "../../../shared/window-size";
import * as prefs from "@renderer/utils/prefs";
import { useAppearanceStore, APPEARANCE_KEYS } from "@renderer/stores/appearance";
import { useKeybindingsStore, STORAGE_KEY as KEYBINDINGS_KEY } from "@renderer/stores/keybindings";
import { useLayoutStore } from "@renderer/stores/layout";
import { LAYOUT_SYNC_PREFIX } from "@renderer/stores/layout-utils";
import { useNotifyStore, PREFS_KEY as NOTIFY_KEY } from "@renderer/stores/notify";
import { usePreviewStore, PREVIEW_SYNC_PREFIX } from "@renderer/stores/preview";
import { usePullRequestsStore, SELECTION_KEY as PULL_REQUESTS_KEY } from "@renderer/stores/pull-requests";
import { useRetryStore } from "@renderer/stores/retry";
import { useRightTabsStore, TABS_STORAGE_PREFIX } from "@renderer/stores/right-tabs";
import { useRuntimeSettingsStore } from "@renderer/stores/runtime-settings";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionStatsStore, TPS_MODE_KEY } from "@renderer/stores/session-stats";
import { useSendShortcutStore, SEND_SHORTCUT_KEY } from "@renderer/stores/send-shortcut";
import { useStreamRenderStore } from "@renderer/stores/stream-render";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useWindowSizeStore } from "@renderer/stores/window-size";

type Applier = (change: StateChange) => void;

const appliers = new Set<Applier>();

/** 注册「共享状态变化后重新读取并应用」的回调（组件级状态用）。 */
export function registerStateApplier(applier: Applier): () => void {
	appliers.add(applier);
	return () => {
		appliers.delete(applier);
	};
}

function matches(prefixes: readonly string[], keys: readonly string[]): boolean {
	return keys.some((key) => prefixes.some((prefix) => key.startsWith(prefix)));
}

function currentRoot(): string | null {
	return useWorkspaceStore.getState().root;
}

/** 偏好变化：各域重新读取自己关心的键并应用。 */
function applyPrefsChange(keys: string[]): void {
	if (matches([...APPEARANCE_KEYS], keys)) {
		useAppearanceStore.getState().refreshFromPrefs();
	}
	if (matches([LAYOUT_SYNC_PREFIX], keys)) {
		const root = currentRoot();
		if (root) useLayoutStore.getState().loadForWorkspace(root);
	}
	if (matches([TABS_STORAGE_PREFIX], keys)) {
		const root = currentRoot();
		if (root) useRightTabsStore.getState().restoreTabs(root);
	}
	if (matches([KEYBINDINGS_KEY], keys)) {
		useKeybindingsStore.getState().refreshFromPrefs();
	}
	if (matches([NOTIFY_KEY], keys)) {
		useNotifyStore.getState().refreshFromPrefs();
	}
	if (matches([PULL_REQUESTS_KEY], keys)) {
		usePullRequestsStore.getState().refreshFromPrefs();
	}
	if (matches([PREVIEW_SYNC_PREFIX], keys)) {
		usePreviewStore.getState().refreshFromPrefs();
	}
	if (matches([TPS_MODE_KEY], keys)) {
		useSessionStatsStore.getState().refreshFromPrefs();
	}
	if (matches([SEND_SHORTCUT_KEY], keys)) {
		useSendShortcutStore.getState().refreshFromPrefs();
	}
	if (matches([REMEMBER_WINDOW_SIZE_PREF], keys)) {
		useWindowSizeStore.getState().refreshFromPrefs();
	}
}

/** 启动共享状态同步：订阅一次，之后所有范围都从这里过。 */
export function startStateSync(): void {
	window.api.state.onChanged((change) => {
		if (change.scope === "prefs") {
			const changed = prefs.applyRemoteChange(
				change.payload as {
					patch: Record<string, string>;
					removed: string[];
				},
			);
			applyPrefsChange(changed);
		} else if (change.scope === "workspace") {
			const root = change.payload as string | null;
			if (root !== useWorkspaceStore.getState().root) {
				if (root) void useWorkspaceStore.getState().openWorkspacePath(root);
				else void useWorkspaceStore.getState().clearWorkspace();
			}
		} else if (change.scope === "session") {
			const active = change.payload as { sessionId: string; cwd: string };
			const sessions = useSessionsStore.getState();
			if (sessions.activeId === active.sessionId) return;
			if (sessions.draftRoot) return;
			void useSessionsStore.getState().selectSession(active.sessionId, active.cwd);
		} else if (change.scope === "models") {
			window.dispatchEvent(new CustomEvent("pi-models-changed"));
		} else if (change.scope === "streamRender") {
			void useStreamRenderStore.getState().refresh();
		} else if (change.scope === "thinkingLanguage") {
			window.dispatchEvent(new CustomEvent("pi-thinking-language-changed"));
		} else if (change.scope === "retry") {
			void useRetryStore.getState().refresh();
		} else if (change.scope === "runtime") {
			void useRuntimeSettingsStore.getState().refresh();
		}
		for (const applier of [...appliers]) {
			try {
				applier(change);
			} catch (error) {
				console.error("[state-sync] applier failed", error);
			}
		}
	});
}
