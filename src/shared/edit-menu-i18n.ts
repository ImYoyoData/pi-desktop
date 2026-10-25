/** Edit context-menu labels keyed by UI locale (main process + renderer). */
export type EditMenuLocale = "zh-CN" | "zh-TW" | "ja" | "en";

/** 支持的语言；与渲染层 UiLocale 同源，供主进程与 worker 校验。 */
export const EDIT_MENU_LOCALES: readonly EditMenuLocale[] = ["zh-CN", "zh-TW", "ja", "en"];

export function isEditMenuLocale(value: unknown): value is EditMenuLocale {
  return typeof value === "string" && (EDIT_MENU_LOCALES as readonly string[]).includes(value);
}

export type EditMenuLabels = {
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  delete: string;
  selectAll: string;
};

const ZH: EditMenuLabels = {
  undo: "撤销",
  redo: "重做",
  cut: "剪切",
  copy: "复制",
  paste: "粘贴",
  delete: "删除",
  selectAll: "全选",
};

const ZH_TW: EditMenuLabels = {
  undo: "復原",
  redo: "重做",
  cut: "剪下",
  copy: "複製",
  paste: "貼上",
  delete: "刪除",
  selectAll: "全選",
};

const JA: EditMenuLabels = {
  undo: "元に戻す",
  redo: "やり直し",
  cut: "切り取り",
  copy: "コピー",
  paste: "貼り付け",
  delete: "削除",
  selectAll: "すべて選択",
};

const EN: EditMenuLabels = {
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  delete: "Delete",
  selectAll: "Select All",
};

export function editMenuLabels(locale: EditMenuLocale): EditMenuLabels {
  return LABELS[locale];
}

const LABELS: Record<EditMenuLocale, EditMenuLabels> = {
  "zh-CN": ZH,
  "zh-TW": ZH_TW,
  ja: JA,
  en: EN,
};
