/** 后台截断提示文案（worker 生成，按界面语言取）。 */

import type { EditMenuLocale } from "./edit-menu-i18n";

/** 界面语言，与主进程 ui-locale 同源。 */
export type BashNoticeLocale = EditMenuLocale;

/** 截断来源：桌面端自动判定常驻进程，或用户手动点击「转到后台」。 */
export type BashTruncationReason = "auto" | "user";

export type BashNoticeLabels = {
	/** 命令转入后台、对话继续。 */
	detached: (reason: BashTruncationReason) => string;
	/** shell 已退出但仍有后台进程存活。 */
	shellSurvivors: (count: number) => string;
};

const ZH: BashNoticeLabels = {
	detached: (reason) =>
		`\n[pi-desktop] ${reason === "auto" ? "自动截断" : "用户截断"}：命令已转入后台运行，对话继续；输出见运行页。\n`,
	shellSurvivors: (count) => `\n[pi-desktop] shell 已退出，仍在跟踪 ${count} 个后台进程…\n`,
};

const EN: BashNoticeLabels = {
	detached: (reason) =>
		`\n[pi-desktop] ${reason === "auto" ? "Auto-truncated" : "User-truncated"}: command moved to background; conversation continues; output is in the Running panel.\n`,
	shellSurvivors: (count) => `\n[pi-desktop] shell exited; tracking ${count} background process(es)…\n`,
};

export function bashNoticeLabels(locale: BashNoticeLocale): BashNoticeLabels {
	return locale === "zh-CN" ? ZH : EN;
}
