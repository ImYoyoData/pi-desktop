/**
 * OMP 设置项的文案翻译。
 *
 * 缺翻译的语言回落到 omp 原文；新增语言时按 OmpTextPack 提供对应字段即可。
 */
export type OmpTextPack = {
	leads?: Record<string, string>;
	groups?: Record<string, string>;
	labels?: Record<string, string>;
	descriptions?: Record<string, string>;
};

import { zhCN } from "./omp-settings-text-zh-cn";

const packByLocale: Record<string, OmpTextPack> = {
	"zh-CN": zhCN,
};

export function ompTabLead(locale: string, tab: string): string | null {
	return packByLocale[locale]?.leads?.[tab] ?? null;
}

export function ompGroupTitle(locale: string, group: string): string | null {
	return packByLocale[locale]?.groups?.[group] ?? null;
}

/** 字段标题：有翻译用翻译，否则保留 omp 原文。 */
export function ompSettingLabel(
	locale: string,
	id: string,
	fallback: string,
): string {
	return packByLocale[locale]?.labels?.[id] ?? fallback;
}

/** 字段说明：有翻译用翻译，否则保留 omp 原文。 */
export function ompSettingDescription(
	locale: string,
	id: string,
	fallback: string,
): string {
	return packByLocale[locale]?.descriptions?.[id] ?? fallback;
}
