import type * as Monaco from "monaco-editor";

export const MONACO_DARK_THEME = "pi-2026-dark";
export const MONACO_LIGHT_THEME = "pi-2026-light";

/**
 * Tracks which monaco instances already have the themes registered.
 * Monaco silently falls back to the built-in `vs` (white) theme when
 * `setTheme` receives an unknown name, so registration must be guaranteed.
 */
const definedFor = new WeakSet<object>();

export function monacoThemeName(dark: boolean): string {
  return dark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME;
}

export function defineMonacoThemes(monaco: typeof Monaco): void {
  if (definedFor.has(monaco)) return;
  monaco.editor.defineTheme(MONACO_DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
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
  monaco.editor.defineTheme(MONACO_LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
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
  definedFor.add(monaco);
}

/** Register (if needed) then activate the theme. Safe to call repeatedly. */
export function applyMonacoColorTheme(monaco: typeof Monaco, dark: boolean): void {
  defineMonacoThemes(monaco);
  monaco.editor.setTheme(monacoThemeName(dark));
}
