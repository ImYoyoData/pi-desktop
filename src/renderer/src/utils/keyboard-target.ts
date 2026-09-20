/** 焦点在文本输入（含可编辑区域）时为 true，快捷键需让位给输入。 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === "TEXTAREA") return true;
  if (target.tagName !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return type !== "checkbox" && type !== "radio";
}
