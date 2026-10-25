import type { EditMenuLocale } from "../shared/edit-menu-i18n";
import { isEditMenuLocale } from "../shared/edit-menu-i18n";

/** Follows renderer UI locale (not OS language). Shared by main-process hosts. */
let uiLocale: EditMenuLocale = "zh-CN";

export function setUiLocale(next: EditMenuLocale): void {
  if (isEditMenuLocale(next)) uiLocale = next;
}

export function getUiLocale(): EditMenuLocale {
  return uiLocale;
}
