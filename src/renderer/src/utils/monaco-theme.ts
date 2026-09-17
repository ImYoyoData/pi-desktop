import type * as Monaco from "monaco-editor";

export const MONACO_DARK_THEME = "pi-2026-dark";
export const MONACO_LIGHT_THEME = "pi-2026-light";

export function monacoThemeName(dark: boolean): string {
  return dark ? MONACO_DARK_THEME : MONACO_LIGHT_THEME;
}

/**
 * 当前行在聚焦时会被画上 2px 描边（currentLineHighlight 运行时注入的样式），
 * 在透明编辑区上很突兀。编辑器可能位于 shadow root 内（外部样式表够不到），
 * 因此按编辑器实际所在的根节点注入覆盖样式。
 */
export function injectEditorStyleOverrides(domNode: HTMLElement | null): void {
  if (!domNode) return;
  const root = domNode.getRootNode();
  const host: ParentNode = root instanceof ShadowRoot ? root : document.head;
  if (host.querySelector("style[data-pi-editor-overrides]")) return;
  const style = document.createElement("style");
  style.dataset.piEditorOverrides = "true";
  style.textContent = `
.monaco-editor .view-overlays .current-line,
.monaco-editor .view-overlays .current-line-exact,
.monaco-editor .view-overlays [class^="current-line"],
.monaco-editor .margin-view-overlays .current-line-margin,
.monaco-editor .margin-view-overlays .current-line-exact-margin,
.monaco-editor .margin-view-overlays [class^="current-line"] {
  border: none !important;
  outline: none !important;
  background-color: var(--pi-editor-line-highlight, rgba(255, 255, 255, 0.08)) !important;
}
.monaco-editor .inputarea,
.monaco-editor textarea.inputarea,
.monaco-editor .native-edit-context,
.monaco-editor .ime-text-area {
  outline: none !important;
}
`;
  host.append(style);
}

/**
 * 每次都重新定义主题：Monaco 的主题颜色只在首次注册时写入，
 * 若做一次性缓存，之后调整颜色定义（例如当前行边框）不会生效。
 */
export function defineMonacoThemes(monaco: typeof Monaco): void {
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
      "editor.lineHighlightBackground": "#ffffff14",
      "editor.lineHighlightBorder": "#00000000",
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
      "editor.lineHighlightBackground": "#0000000d",
      "editor.lineHighlightBorder": "#00000000",
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

/** Register (if needed) then activate the theme. Safe to call repeatedly. */
export function applyMonacoColorTheme(monaco: typeof Monaco, dark: boolean): void {
  defineMonacoThemes(monaco);
  monaco.editor.setTheme(monacoThemeName(dark));
}
