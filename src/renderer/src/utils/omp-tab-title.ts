import type { useI18n } from "@renderer/i18n/use-i18n";

type Messages = ReturnType<typeof useI18n>;

/** omp tab 的显示名：桌面端翻译，字段文案仍用 omp 原文。 */
export function ompTabTitle(t: Messages, tab: string): string {
	switch (tab) {
		case "appearance":
			return t.ompTabAppearance;
		case "model":
			return t.ompTabModel;
		case "interaction":
			return t.ompTabInteraction;
		case "context":
			return t.ompTabContext;
		case "memory":
			return t.ompTabMemory;
		case "files":
			return t.ompTabFiles;
		case "shell":
			return t.ompTabShell;
		case "tools":
			return t.ompTabTools;
		case "tasks":
			return t.ompTabTasks;
		case "providers":
			return t.ompTabProviders;
		default:
			return tab;
	}
}
