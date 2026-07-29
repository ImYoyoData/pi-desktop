import type * as Monaco from "monaco-editor";

let applied: "vs" | "vs-dark" | null = null;

/** Monaco themes are global — call once per mode, not per editor instance. */
export function applyMonacoColorTheme(monaco: typeof Monaco, dark: boolean): void {
  const next = dark ? "vs-dark" : "vs";
  if (applied === next) return;
  applied = next;
  monaco.editor.setTheme(next);
}
