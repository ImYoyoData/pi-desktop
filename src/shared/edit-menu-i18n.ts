/** Edit context-menu labels keyed by UI locale (main process + renderer). */
export type EditMenuLocale = "zh-CN" | "en";

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
  return locale === "zh-CN" ? ZH : EN;
}
