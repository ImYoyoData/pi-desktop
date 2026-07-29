<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type * as Monaco from "monaco-editor";
import monacoCssUrl from "../../../../node_modules/monaco-editor/min/vs/editor/editor.main.css?url";
import { languageFromPath } from "@renderer/utils/editor-lang";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import { applyMonacoColorTheme } from "@renderer/utils/monaco-theme";
import { useAppearanceStore } from "@renderer/stores/appearance";

if (!document.getElementById("monaco-editor-css")) {
  const link = document.createElement("link");
  link.id = "monaco-editor-css";
  link.rel = "stylesheet";
  link.href = monacoCssUrl;
  document.head.appendChild(link);
}

const props = defineProps<{
  filePath: string;
  oldContent: string;
  newContent: string;
}>();

const appearance = useAppearanceStore();
const host = ref<HTMLElement | null>(null);

let monacoApi: typeof Monaco | null = null;
let diffEditor: Monaco.editor.IStandaloneDiffEditor | null = null;
let originalModel: Monaco.editor.ITextModel | null = null;
let modifiedModel: Monaco.editor.ITextModel | null = null;
let gen = 0;

const language = computed(() => languageFromPath(props.filePath));
const isFullAdd = computed(() => !props.oldContent && Boolean(props.newContent));
const isFullDelete = computed(() => Boolean(props.oldContent) && !props.newContent);

function disposeModels(): void {
  originalModel?.dispose();
  modifiedModel?.dispose();
  originalModel = null;
  modifiedModel = null;
}

function disposeEditor(): void {
  diffEditor?.dispose();
  diffEditor = null;
  disposeModels();
}

function applyInlineEditorOptions(): void {
  if (!diffEditor) return;
  // Inline view keeps both editors in DOM; hide the original gutter so we don't
  // get two line-number columns glued together.
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
  const myGen = ++gen;
  await nextTick();
  if (!host.value || myGen !== gen) return;
  if (!monacoApi) monacoApi = await loadMonaco();
  if (myGen !== gen) return;
  const monaco = monacoApi;
  const theme = appearance.resolvedTheme === "dark" ? "vs-dark" : "vs";
  applyMonacoColorTheme(monaco, appearance.resolvedTheme === "dark");

  if (!diffEditor) {
    diffEditor = monaco.editor.createDiffEditor(host.value, {
      theme,
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: false,
      useInlineViewWhenSpaceIsLimited: true,
      enableSplitViewResizing: false,
      renderOverviewRuler: true,
      originalEditable: false,
      fontSize: 12.5,
      fontFamily: 'var(--font-mono), "Cascadia Code", Consolas, monospace',
      lineHeight: 20,
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
      // Full add/delete: keep every line visible (all green / all red).
      hideUnchangedRegions: {
        enabled: !isFullAdd.value && !isFullDelete.value,
        contextLineCount: 3,
        minimumLineCount: 4,
        revealLineCount: 20,
      },
      diffAlgorithm: "advanced",
    });
    applyInlineEditorOptions();
  } else {
    applyMonacoColorTheme(monaco, appearance.resolvedTheme === "dark");
    diffEditor.updateOptions({
      hideUnchangedRegions: {
        enabled: !isFullAdd.value && !isFullDelete.value,
        contextLineCount: 3,
        minimumLineCount: 4,
        revealLineCount: 20,
      },
    });
    applyInlineEditorOptions();
  }

  disposeModels();
  originalModel = monaco.editor.createModel(props.oldContent, language.value);
  modifiedModel = monaco.editor.createModel(props.newContent, language.value);
  if (myGen !== gen) {
    disposeModels();
    return;
  }
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  await nextTick();
  if (myGen !== gen || !diffEditor) return;
  applyInlineEditorOptions();
  diffEditor.layout();
}

watch(
  () => [props.filePath, props.oldContent, props.newContent] as const,
  () => {
    void ensureDiffEditor();
  },
  { immediate: true },
);

watch(
  () => appearance.resolvedTheme,
  (mode) => {
    if (!monacoApi || !diffEditor) return;
    applyMonacoColorTheme(monacoApi, mode === "dark");
  },
);

onBeforeUnmount(() => {
  gen += 1;
  disposeEditor();
});
</script>

<template>
  <div ref="host" class="diff-editor-host" />
</template>

<style scoped>
.diff-editor-host {
  width: 100%;
  height: 100%;
  min-height: 0;
}

/* Keep inline original pane from painting a second line-number rail */
.diff-editor-host :deep(.editor.original .margin),
.diff-editor-host :deep(.editor.original .monaco-editor .margin-view-overlays) {
  width: 0 !important;
  min-width: 0 !important;
  opacity: 0;
  pointer-events: none;
}
</style>
