import type * as Monaco from "monaco-editor";

const DARK_THEME = "pi-2026-dark";
const LIGHT_THEME = "pi-2026-light";

let applied: "dark" | "light" | null = null;

/** Monaco themes are global — define once, then switch per mode. */
function defineThemes(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    colors: {
      "editor.background": "#121314",
      "editor.foreground": "#f5f6f7",
      "editorLineNumber.foreground": "#adb2b8",
      "editorLineNumber.activeForeground": "#f5f6f7",
      "editor.selectionBackground": "#276782dd",
      "editorCursor.foreground": "#f5f6f7",
      "editor.lineHighlightBackground": "#242526",
      "editorIndentGuide.background1": "#8384854d",
      "editorIndentGuide.activeBackground1": "#838485",
      "editorWidget.background": "#202122",
      "editorWidget.border": "#2a2b2c",
      "editorSuggestWidget.background": "#202122",
      "editorSuggestWidget.selectedBackground": "#ffffff26",
      "editorGutter.addedBackground": "#72c892",
      "editorGutter.deletedBackground": "#f28772",
      "diffEditor.insertedLineBackground": "#347d3926",
      "diffEditor.insertedTextBackground": "#57ab5a4d",
      "diffEditor.removedLineBackground": "#c93c3726",
      "diffEditor.removedTextBackground": "#f470674d",
    },
  });
  monaco.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#202020",
      "editorLineNumber.foreground": "#606060",
      "editorLineNumber.activeForeground": "#202020",
      "editor.selectionBackground": "#0069cc40",
      "editorCursor.foreground": "#202020",
      "editor.lineHighlightBackground": "#eaeaea40",
      "editorIndentGuide.background1": "#f7f7f740",
      "editorIndentGuide.activeBackground1": "#eeeeee",
      "editorWidget.background": "#fafafd",
      "editorWidget.border": "#e4e5e6",
      "editorSuggestWidget.background": "#fafafd",
      "editorSuggestWidget.selectedBackground": "#00000025",
      "editorGutter.addedBackground": "#587c0c",
      "editorGutter.deletedBackground": "#ad0707",
      "diffEditor.insertedTextBackground": "#587c0c26",
      "diffEditor.removedTextBackground": "#ad070726",
    },
  });
}

export function applyMonacoColorTheme(monaco: typeof Monaco, dark: boolean): void {
  if (applied === null) defineThemes(monaco);
  const next = dark ? "dark" : "light";
  if (applied === next) return;
  applied = next;
  monaco.editor.setTheme(dark ? DARK_THEME : LIGHT_THEME);
}
