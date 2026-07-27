<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type * as Monaco from "monaco-editor";
import monacoCssUrl from "../../../../node_modules/monaco-editor/min/vs/editor/editor.main.css?url";
import { languageFromPath } from "@renderer/utils/editor-lang";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import { useAppearanceStore } from "@renderer/stores/appearance";

if (!document.getElementById("monaco-editor-css")) {
  const link = document.createElement("link");
  link.id = "monaco-editor-css";
  link.rel = "stylesheet";
  link.href = monacoCssUrl;
  document.head.appendChild(link);
}

(self as unknown as { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker() {
    return undefined as unknown as Worker;
  },
};

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

const language = computed(() => languageFromPath(props.filePath));

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

async function ensureDiffEditor(): Promise<void> {
  await nextTick();
  if (!host.value) return;
  if (!monacoApi) monacoApi = await loadMonaco();
  const monaco = monacoApi;
  const theme = appearance.resolvedTheme === "dark" ? "vs-dark" : "vs";

  if (!diffEditor) {
    diffEditor = monaco.editor.createDiffEditor(host.value, {
      theme,
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: false,
      enableSplitViewResizing: false,
      renderOverviewRuler: true,
      originalEditable: false,
      fontSize: 12.5,
      fontFamily: 'var(--font-mono), "Cascadia Code", Consolas, monospace',
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      wordWrap: "on",
      smoothScrolling: true,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      renderMarginRevertIcon: false,
      glyphMargin: false,
      folding: true,
      lineNumbers: "on",
      diffWordWrap: "on",
    });
  } else {
    monaco.editor.setTheme(theme);
  }

  disposeModels();
  originalModel = monaco.editor.createModel(props.oldContent, language.value);
  modifiedModel = monaco.editor.createModel(props.newContent, language.value);
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  await nextTick();
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
    monacoApi.editor.setTheme(mode === "dark" ? "vs-dark" : "vs");
  },
);

onBeforeUnmount(() => {
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
</style>
