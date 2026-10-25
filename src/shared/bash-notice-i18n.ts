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
	return LABELS[locale];
}

const ZH_TW: BashNoticeLabels = {
	detached: (reason) =>
		`\n[pi-desktop] ${reason === "auto" ? "自動截斷" : "使用者截斷"}：命令已轉入背景執行，對話繼續；輸出見執行頁。\n`,
	shellSurvivors: (count) => `\n[pi-desktop] shell 已結束，仍在追蹤 ${count} 個背景程序…\n`,
};

const JA: BashNoticeLabels = {
	detached: (reason) =>
		`\n[pi-desktop] ${reason === "auto" ? "自動切り詰め" : "ユーザーによる切り詰め"}: コマンドはバックグラウンドで実行を続けます。会話は続行され、出力は実行ページで確認できます。\n`,
	shellSurvivors: (count) => `\n[pi-desktop] shell は終了しました。${count} 個のバックグラウンドプロセスを追跡中…\n`,
};

const LABELS: Record<BashNoticeLocale, BashNoticeLabels> = {
	"zh-CN": ZH,
	"zh-TW": ZH_TW,
	ja: JA,
	en: EN,
};
