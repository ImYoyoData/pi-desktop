import type { EditMenuLocale } from "../shared/edit-menu-i18n";

/** Follows renderer UI locale (not OS language). Shared by main-process hosts. */
let uiLocale: EditMenuLocale = "zh-CN";

export function setUiLocale(next: EditMenuLocale): void {
  if (next === "zh-CN" || next === "en") uiLocale = next;
}

export function getUiLocale(): EditMenuLocale {
  return uiLocale;
}
