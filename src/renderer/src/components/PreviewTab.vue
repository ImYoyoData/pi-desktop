<script setup lang="ts">
import type { PreviewResult } from "../../../shared/preview-types";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NAlert, NButton, NEmpty, NIcon, NSpin, NText, useDialog, useMessage } from "naive-ui";
import { FolderOpenOutline, SaveOutline } from "@vicons/ionicons5";
import type * as Monaco from "monaco-editor";
import monacoCssUrl from "../../../../node_modules/monaco-editor/min/vs/editor/editor.main.css?url";
import { breadcrumbs, languageFromPath } from "@renderer/utils/editor-lang";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { t } from "@renderer/i18n";

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
  filePath?: string | null;
  tabId?: string;
  active?: boolean;
}>();

const message = useMessage();
const dialog = useDialog();
const rightTabs = useRightTabsStore();
const currentPath = ref<string | null>(props.filePath ?? null);
const result = ref<PreviewResult | null>(null);
const loading = ref(false);
const dirty = ref(false);
const saving = ref(false);
const missing = ref(false);
const editorHost = ref<HTMLElement | null>(null);
let monacoApi: typeof Monaco | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
/** Content fingerprint last loaded from disk (for external-change detection). */
let diskFingerprint = "";
let reloadPromptOpen = false;
let applyingExternal = false;

const crumbs = computed(() => (currentPath.value ? breadcrumbs(currentPath.value) : []));

function syncTabMeta(patch: { dirty?: boolean; missing?: boolean; gitCode?: string }): void {
  if (!props.tabId) return;
  rightTabs.patchTab(props.tabId, patch);
}

function fingerprint(content: string): string {
  return `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}`;
}

function disposeEditor(): void {
  editor?.dispose();
  editor = null;
}

async function ensureEditor(content: string, language: string): Promise<void> {
  if (!editorHost.value) return;
  if (!monacoApi) monacoApi = await loadMonaco();
  const monaco = monacoApi;
  applyingExternal = true;
  if (!editor) {
    editor = monaco.editor.create(editorHost.value, {
      value: content,
      language,
      theme: "vs",
      automaticLayout: true,
      fontSize: 12.5,
      fontFamily: 'var(--font-mono), "Cascadia Code", Consolas, monospace',
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      padding: { top: 8 },
      tabSize: 2,
      wordWrap: "on",
      smoothScrolling: true,
      quickSuggestions: false,
      parameterHints: { enabled: false },
      suggestOnTriggerCharacters: false,
      hover: { enabled: false },
    });
    editor.onDidChangeModelContent(() => {
      if (applyingExternal) return;
      dirty.value = true;
      syncTabMeta({ dirty: true });
    });
  } else {
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
      if (model.getValue() !== content) {
        editor.pushUndoStop();
        model.setValue(content);
        editor.pushUndoStop();
      }
    }
  }
  diskFingerprint = fingerprint(content);
  dirty.value = false;
  missing.value = false;
  syncTabMeta({ dirty: false, missing: false });
  applyingExternal = false;
}

async function refreshGitForFile(path: string): Promise<void> {
  try {
    const status = await window.api.git.status();
    const hit = status.files.find((f) => f.relativePath === path);
    syncTabMeta({ gitCode: hit?.code });
  } catch {
    // ignore
  }
}

async function loadPath(path: string | null): Promise<void> {
  currentPath.value = path;
  result.value = null;
  dirty.value = false;
  missing.value = false;
  diskFingerprint = "";
  if (!path) {
    disposeEditor();
    syncTabMeta({ dirty: false, missing: false });
    return;
  }
  loading.value = true;
  try {
    result.value = await window.api.preview.read(path);
    await nextTick();
    if (result.value?.kind === "error") {
      disposeEditor();
      missing.value = true;
      syncTabMeta({ missing: true, dirty: false });
      return;
    }
    missing.value = false;
    syncTabMeta({ missing: false });
    if (result.value?.kind === "text" || result.value?.kind === "markdown") {
      await ensureEditor(result.value.content, languageFromPath(path));
    } else {
      disposeEditor();
      syncTabMeta({ dirty: false });
    }
    await refreshGitForFile(path);
  } finally {
    loading.value = false;
  }
}

function promptReloadFromDisk(): void {
  if (reloadPromptOpen || !currentPath.value) return;
  reloadPromptOpen = true;
  dialog.warning({
    title: t.fileExternallyModified,
    content: dirty.value ? t.externalChangedDirty : t.externalChanged,
    positiveText: t.reloadFromDisk,
    negativeText: t.keepCurrent,
    onPositiveClick: () => {
      reloadPromptOpen = false;
      void loadPath(currentPath.value);
    },
    onNegativeClick: () => {
      reloadPromptOpen = false;
    },
    onClose: () => {
      reloadPromptOpen = false;
    },
  });
}

function onFsChanged(event: Event): void {
  const detail = (event as CustomEvent<{
    root: string;
    events: { path: string; kind: "add" | "change" | "unlink" }[];
  }>).detail;
  if (!detail || !currentPath.value) return;
  // Ignore events from a previous workspace watcher
  const wsRoot = useWorkspaceStore().root;
  if (!wsRoot) return;
  const rootA = detail.root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const rootB = wsRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  if (rootA !== rootB) return;

  const path = currentPath.value.replace(/\\/g, "/");
  const hit = detail.events.find((e) => e.path.replace(/\\/g, "/") === path);
  if (!hit) return;

  if (hit.kind === "unlink") {
    missing.value = true;
    syncTabMeta({ missing: true });
    return;
  }

  if (hit.kind === "add" || hit.kind === "change") {
    void (async () => {
      const res = await window.api.preview.read(path);
      if (res.kind === "error") {
        missing.value = true;
        syncTabMeta({ missing: true });
        return;
      }
      if (missing.value) {
        missing.value = false;
        syncTabMeta({ missing: false });
      }
      if (res.kind !== "text" && res.kind !== "markdown") return;
      const nextFp = fingerprint(res.content);
      if (nextFp === diskFingerprint) return;
      // Our own save also triggers fs watch — skip if editor matches disk
      const editorValue = editor?.getValue() ?? "";
      if (editorValue === res.content) {
        diskFingerprint = nextFp;
        dirty.value = false;
        syncTabMeta({ dirty: false });
        return;
      }
      promptReloadFromDisk();
    })();
  }
}

watch(
  () => props.filePath,
  (path) => {
    void loadPath(path ?? null);
  },
  { immediate: true },
);

watch(
  () => props.active,
  (active) => {
    if (active && currentPath.value) {
      void refreshGitForFile(currentPath.value);
    }
  },
);

async function pickFile(): Promise<void> {
  const picked = await window.api.preview.pickFile();
  if (picked) await loadPath(picked);
}

async function save(): Promise<boolean> {
  if (!currentPath.value) return false;
  const wasMissing = missing.value;
  const content =
    editor?.getValue() ??
    (result.value?.kind === "text" || result.value?.kind === "markdown"
      ? result.value.content
      : "");
  if (!editor && content === "" && !wasMissing) return false;

  saving.value = true;
  try {
    await window.api.preview.write(currentPath.value, content);
    if (wasMissing || !editor) {
      await loadPath(currentPath.value);
    } else {
      diskFingerprint = fingerprint(content);
      dirty.value = false;
      missing.value = false;
      syncTabMeta({ dirty: false, missing: false });
      await refreshGitForFile(currentPath.value);
    }
    message.success(wasMissing ? t.recreatedAndSaved : t.saved);
    return true;
  } catch (err) {
    message.error(err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  if (props.tabId) {
    rightTabs.registerSaveHandler(props.tabId, save);
  }
  window.addEventListener("pi-fs-changed", onFsChanged);
});

onBeforeUnmount(() => {
  if (props.tabId) rightTabs.unregisterSaveHandler(props.tabId);
  window.removeEventListener("pi-fs-changed", onFsChanged);
  disposeEditor();
});
</script>

<template>
  <div class="preview-tab">
    <div class="toolbar">
      <div class="crumbs" :title="currentPath ?? undefined">
        <template v-if="crumbs.length">
          <span v-for="(part, i) in crumbs" :key="`${part}-${i}`" class="crumb">
            <span v-if="i > 0" class="sep">›</span>
            <span :class="{ file: i === crumbs.length - 1, missing }">{{ part }}</span>
          </span>
          <span v-if="dirty" class="dirty">●</span>
          <span v-if="missing" class="gone">{{ t.deletedBadge }}</span>
        </template>
        <NText v-else depth="3" style="font-size: 11px">{{ t.noFileOpen }}</NText>
      </div>
      <div class="actions">
        <NButton
          v-if="result?.kind === 'text' || result?.kind === 'markdown' || missing"
          size="tiny"
          quaternary
          :disabled="!dirty && !missing"
          :loading="saving"
          @click="() => void save()"
        >
          <template #icon>
            <NIcon :component="SaveOutline" :size="14" />
          </template>
          {{ missing ? t.saveAsNew : t.save }}
        </NButton>
        <NButton size="tiny" quaternary @click="pickFile">
          <template #icon>
            <NIcon :component="FolderOpenOutline" :size="14" />
          </template>
          {{ t.openFileEllipsis }}
        </NButton>
      </div>
    </div>
    <div class="viewport">
      <NEmpty v-if="!currentPath" :description="t.previewHint" size="small" />
      <NSpin v-else :show="loading" class="spin">
        <template v-if="result">
          <NAlert v-if="result.kind === 'error' || missing" type="error" :bordered="false">
            {{ t.fileDeletedHint }}
          </NAlert>
          <NAlert v-else-if="result.kind === 'unsupported'" type="warning" :bordered="false">
            {{ t.previewUnsupported }}
          </NAlert>
          <template v-else-if="result.kind === 'text' || result.kind === 'markdown'">
            <NAlert
              v-if="result.truncated"
              type="warning"
              :bordered="false"
              style="margin: 4px 8px"
            >
              {{ t.previewTruncated }}
            </NAlert>
            <div ref="editorHost" class="editor" />
          </template>
          <img v-else-if="result.kind === 'image'" class="img" :src="result.dataUrl" :alt="result.path" />
        </template>
      </NSpin>
    </div>
  </div>
</template>

<style scoped>
.preview-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.crumbs {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11.5px;
  color: var(--fg-muted);
}

.crumb .sep {
  margin: 0 4px;
  color: var(--fg-faint);
}

.crumb .file {
  color: var(--fg-strong);
  font-weight: 550;
}

.crumb .file.missing {
  color: var(--git-d, #dc2626);
  text-decoration: line-through;
}

.dirty {
  margin-left: 6px;
  color: var(--accent);
  font-size: 10px;
}

.gone {
  margin-left: 8px;
  color: var(--git-d, #dc2626);
  font-size: 11px;
}

.actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.spin {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.spin :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 8px;
  border-radius: 4px;
}
</style>
