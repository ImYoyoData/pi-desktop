import { useEffect, useRef, type ReactNode } from "react";
import type * as Monaco from "monaco-editor";
import { languageFromPath } from "@renderer/utils/editor-lang";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import {
  applyMonacoColorTheme,
  injectEditorStyleOverrides,
  monacoThemeName,
} from "@renderer/utils/monaco-theme";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { fontSizePx } from "../../../shared/appearance";
import styles from "./ChangesDiffEditor.module.css";

type Props = {
  filePath: string;
  oldContent: string;
  newContent: string;
};

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function ChangesDiffEditor({
  filePath,
  oldContent,
  newContent,
}: Props): ReactNode {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const genRef = useRef(0);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const resolvedTheme = useAppearanceStore((s) => s.resolvedTheme);
  const fontSize = useAppearanceStore((s) => s.fontSize);
  const editorFontPx = fontSizePx(12.5, fontSize);
  const themeRef = useRef(resolvedTheme);
  themeRef.current = resolvedTheme;

  const language = languageFromPath(filePath);
  const isFullAdd = !oldContent && Boolean(newContent);
  const isFullDelete = Boolean(oldContent) && !newContent;

  function disposeModels(): void {
    originalModelRef.current?.dispose();
    modifiedModelRef.current?.dispose();
    originalModelRef.current = null;
    modifiedModelRef.current = null;
  }

  function applyInlineEditorOptions(): void {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;
    diffEditor.getOriginalEditor().updateOptions({
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      renderLineHighlight: "none",
      overviewRulerLanes: 0,
    });
    diffEditor.getModifiedEditor().updateOptions({
      lineNumbers: "on",
      glyphMargin: false,
      folding: false,
      renderLineHighlight: "line",
      lineDecorationsWidth: 10,
      lineNumbersMinChars: 3,
    });
  }

  async function ensureDiffEditor(): Promise<void> {
    const myGen = ++genRef.current;
    await nextFrame();
    const host = hostRef.current;
    if (!host || myGen !== genRef.current) return;
    if (!monacoRef.current) monacoRef.current = await loadMonaco();
    if (myGen !== genRef.current) return;
    const monaco = monacoRef.current;
    const dark = themeRef.current === "dark";
    applyMonacoColorTheme(monaco, dark);

    if (!diffEditorRef.current) {
      const fontPx = fontSizePx(12.5, useAppearanceStore.getState().fontSize);
      diffEditorRef.current = monaco.editor.createDiffEditor(host, {
        theme: monacoThemeName(dark),
        useShadowDOM: false,
        automaticLayout: true,
        readOnly: true,
        renderSideBySide: false,
        useInlineViewWhenSpaceIsLimited: true,
        enableSplitViewResizing: false,
        renderOverviewRuler: true,
        originalEditable: false,
        fontSize: fontPx,
        fontFamily: 'var(--font-mono), "Cascadia Code", Consolas, monospace',
        lineHeight: Math.round(fontPx * 1.6),
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 8 },
        wordWrap: "off",
        diffWordWrap: "off",
        smoothScrolling: true,
        ignoreTrimWhitespace: false,
        renderIndicators: true,
        renderMarginRevertIcon: false,
        renderGutterMenu: false,
        glyphMargin: false,
        folding: false,
        lineNumbers: "on",
        hideUnchangedRegions: {
          enabled: !isFullAdd && !isFullDelete,
          contextLineCount: 3,
          minimumLineCount: 4,
          revealLineCount: 20,
        },
        diffAlgorithm: "advanced",
      });
      injectEditorStyleOverrides(diffEditorRef.current.getModifiedEditor().getDomNode());
      applyInlineEditorOptions();
    } else {
      applyMonacoColorTheme(monaco, themeRef.current === "dark");
      diffEditorRef.current.updateOptions({
        hideUnchangedRegions: {
          enabled: !isFullAdd && !isFullDelete,
          contextLineCount: 3,
          minimumLineCount: 4,
          revealLineCount: 20,
        },
      });
      applyInlineEditorOptions();
    }

    disposeModels();
    const originalModel = monaco.editor.createModel(oldContent, language);
    const modifiedModel = monaco.editor.createModel(newContent, language);
    originalModelRef.current = originalModel;
    modifiedModelRef.current = modifiedModel;
    if (myGen !== genRef.current) {
      disposeModels();
      return;
    }
    diffEditorRef.current.setModel({ original: originalModel, modified: modifiedModel });
    await nextFrame();
    if (myGen !== genRef.current || !diffEditorRef.current) return;
    applyInlineEditorOptions();
    diffEditorRef.current.layout();
  }

  useEffect(() => {
    void ensureDiffEditor();
  }, [filePath, oldContent, newContent]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !diffEditorRef.current) return;
    applyMonacoColorTheme(monaco, resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    diffEditorRef.current?.updateOptions({
      fontSize: editorFontPx,
      lineHeight: Math.round(editorFontPx * 1.6),
    });
  }, [editorFontPx]);

  useEffect(() => {
    return () => {
      genRef.current += 1;
      diffEditorRef.current?.dispose();
      diffEditorRef.current = null;
      originalModelRef.current?.dispose();
      originalModelRef.current = null;
      modifiedModelRef.current?.dispose();
      modifiedModelRef.current = null;
    };
  }, []);

  return <div ref={hostRef} className={styles.host} />;
}

export default ChangesDiffEditor;
