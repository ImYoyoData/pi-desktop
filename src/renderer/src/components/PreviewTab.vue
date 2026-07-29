<script setup lang="ts">
import type { PreviewResult } from "../../../shared/preview-types";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NAlert, NButton, NEmpty, NIcon, NSpin, NText, useDialog, useMessage } from "naive-ui";
import { FolderOpenOutline, SaveOutline } from "@vicons/ionicons5";
import type * as Monaco from "monaco-editor";
import monacoCssUrl from "../../../../node_modules/monaco-editor/min/vs/editor/editor.main.css?url";
import MarkdownView from "@renderer/components/MarkdownView.vue";
import { breadcrumbs, languageFromPath } from "@renderer/utils/editor-lang";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import { applyMonacoColorTheme } from "@renderer/utils/monaco-theme";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useLayoutStore } from "@renderer/stores/layout";
import { useMediaStore } from "@renderer/stores/media";
import { t } from "@renderer/i18n";

type MdViewMode = "edit" | "preview" | "split";

if (!document.getElementById("monaco-editor-css")) {
  const link = document.createElement("link");
  link.id = "monaco-editor-css";
  link.rel = "stylesheet";
  link.href = monacoCssUrl;
  document.head.appendChild(link);
}

const props = defineProps<{
  filePath?: string | null;
  tabId?: string;
  active?: boolean;
}>();

const message = useMessage();
const dialog = useDialog();
const rightTabs = useRightTabsStore();
const appearance = useAppearanceStore();
const layout = useLayoutStore();
const media = useMediaStore();
/** Match main `fs-watch-host` rootsEqual: only Windows folds case. */
let pathCaseInsensitive = false;
void window.api.window.platform().then((p) => {
  pathCaseInsensitive = p === "win32";
});
const currentPath = ref<string | null>(props.filePath ?? null);
const result = ref<PreviewResult | null>(null);
const loading = ref(false);
const dirty = ref(false);
const saving = ref(false);
const missing = ref(false);
const editorHost = ref<HTMLElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const audioRef = ref<HTMLAudioElement | null>(null);
const liveContent = ref("");
const mdViewMode = ref<MdViewMode>("preview");
let monacoApi: typeof Monaco | null = null;
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
/** Bumps on every loadPath to ignore stale async reads when switching files quickly. */
let loadGen = 0;
/** Content fingerprint last loaded from disk (for external-change detection). */
let diskFingerprint = "";
let reloadPromptOpen = false;
let applyingExternal = false;
let unregisterVideo: (() => void) | undefined;
let unregisterAudio: (() => void) | undefined;

const crumbs = computed(() => (currentPath.value ? breadcrumbs(currentPath.value) : []));
const isMarkdown = computed(() => result.value?.kind === "markdown");
const showEditor = computed(
  () =>
    (result.value?.kind === "text" || result.value?.kind === "markdown") &&
    (!isMarkdown.value || mdViewMode.value !== "preview"),
);
const showMdPreview = computed(() => isMarkdown.value && mdViewMode.value !== "edit");
const mediaVisible = computed(() => Boolean(props.active) && !layout.rightCollapsed);
const mediaIdPrefix = computed(() => `preview:${props.tabId ?? "anon"}:`);

function stopMedia(): void {
  media.stopByPrefix(mediaIdPrefix.value);
}

function syncMediaRegistration(): void {
  unregisterVideo?.();
  unregisterAudio?.();
  unregisterVideo = undefined;
  unregisterAudio = undefined;
  const prefix = mediaIdPrefix.value;
  if (videoRef.value) {
    unregisterVideo = media.register(`${prefix}video`, videoRef.value);
  }
  if (audioRef.value) {
    unregisterAudio = media.register(`${prefix}audio`, audioRef.value);
  }
}

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

function editorHostIsLive(): boolean {
  if (!editor || !editorHost.value) return false;
  const dom = editor.getDomNode();
  return Boolean(dom && editorHost.value.contains(dom));
}

async function ensureEditor(content: string, language: string): Promise<void> {
  await nextTick();
  if (!editorHost.value) {
    liveContent.value = content;
    diskFingerprint = fingerprint(content);
    dirty.value = false;
    missing.value = false;
    syncTabMeta({ dirty: false, missing: false });
    return;
  }
  // Switching files temporarily remounts the host — recreate Monaco on the new node
  if (editor && !editorHostIsLive()) {
    disposeEditor();
  }
  if (!monacoApi) monacoApi = await loadMonaco();
  const monaco = monacoApi;
  applyingExternal = true;
  if (!editor) {
    editor = monaco.editor.create(editorHost.value, {
      value: content,
      language,
      theme: appearance.resolvedTheme === "dark" ? "vs-dark" : "vs",
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
      // Needed so json / json5 validation messages are readable on hover.
      hover: { enabled: true },
    });
    applyMonacoColorTheme(monaco, appearance.resolvedTheme === "dark");
    editor.onDidChangeModelContent(() => {
      liveContent.value = editor?.getValue() ?? "";
      if (applyingExternal) return;
      dirty.value = true;
      syncTabMeta({ dirty: true });
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void save();
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
  liveContent.value = content;
  diskFingerprint = fingerprint(content);
  dirty.value = false;
  missing.value = false;
  syncTabMeta({ dirty: false, missing: false });
  applyingExternal = false;
  await nextTick();
  editor?.layout();
}

watch(
  () => appearance.resolvedTheme,
  (mode) => {
    if (!monacoApi || !editor) return;
    applyMonacoColorTheme(monacoApi, mode === "dark");
  },
);

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
  const gen = ++loadGen;
  currentPath.value = path;
  dirty.value = false;
  missing.value = false;
  diskFingerprint = "";
  if (!path) {
    result.value = null;
    liveContent.value = "";
    disposeEditor();
    syncTabMeta({ dirty: false, missing: false });
    return;
  }
  loading.value = true;
  try {
    // Keep previous result mounted while loading so Monaco's host is not torn down
    // mid-switch (that left a blank tab when reusing the transient preview tab).
    const next = await window.api.preview.read(path);
    if (gen !== loadGen) return;

    if (next.kind === "error") {
      // Keep editor + cached content when the open file disappears (delete / rename).
      const hadCachedDoc =
        (result.value?.kind === "text" || result.value?.kind === "markdown") &&
        Boolean(liveContent.value || editor);
      if (hadCachedDoc) {
        missing.value = true;
        syncTabMeta({ missing: true });
        return;
      }
      result.value = next;
      disposeEditor();
      liveContent.value = "";
      missing.value = true;
      syncTabMeta({ missing: true, dirty: false });
      return;
    }

    const prevKind = result.value?.kind;
    const nextIsEditor = next.kind === "text" || next.kind === "markdown";
    const prevIsEditor = prevKind === "text" || prevKind === "markdown";
    // Kind change remounts the template branch — dispose before swapping result
    if (editor && (!nextIsEditor || !prevIsEditor)) {
      disposeEditor();
    }

    result.value = next;
    missing.value = false;
    syncTabMeta({ missing: false });
    await nextTick();
    if (gen !== loadGen) return;

    if (next.kind === "text" || next.kind === "markdown") {
      if (next.kind === "markdown") {
        mdViewMode.value = "preview";
      } else {
        mdViewMode.value = "edit";
      }
      await nextTick();
      if (gen !== loadGen) return;
      await ensureEditor(next.content, languageFromPath(path));
    } else {
      stopMedia();
      disposeEditor();
      liveContent.value = "";
      syncTabMeta({ dirty: false });
    }
    await refreshGitForFile(path);
  } finally {
    if (gen === loadGen) loading.value = false;
  }
}

watch(mdViewMode, async () => {
  if (!isMarkdown.value || !currentPath.value) return;
  await nextTick();
  if (!editor && showEditor.value) {
    await ensureEditor(liveContent.value, languageFromPath(currentPath.value));
  } else {
    editor?.layout();
  }
});

watch(
  () => props.active,
  (active) => {
    if (active && currentPath.value) {
      void refreshGitForFile(currentPath.value);
      void nextTick(() => editor?.layout());
    } else {
      stopMedia();
    }
  },
);

watch(
  () => layout.rightCollapsed,
  (collapsed) => {
    if (collapsed) stopMedia();
  },
);

watch(mediaVisible, (visible) => {
  if (!visible) stopMedia();
});

watch([videoRef, audioRef, () => result.value?.kind, () => props.tabId], () => {
  void nextTick(() => syncMediaRegistration());
});

function promptReloadFromDisk(): void {
  if (reloadPromptOpen || !currentPath.value) return;
  reloadPromptOpen = true;
  dialog.warning({
    title: t.fileExternallyModified,
    content: t.externalChangedDirty,
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

async function applyDiskContentSilently(path: string, content: string): Promise<void> {
  applyingExternal = true;
  try {
    if (editor && editorHostIsLive()) {
      const model = editor.getModel();
      if (model && model.getValue() !== content) {
        editor.pushUndoStop();
        model.setValue(content);
        editor.pushUndoStop();
      }
    }
    liveContent.value = content;
    diskFingerprint = fingerprint(content);
    dirty.value = false;
    missing.value = false;
    if (result.value?.kind === "text" || result.value?.kind === "markdown") {
      result.value = { ...result.value, content };
    }
    syncTabMeta({ dirty: false, missing: false });
  } finally {
    applyingExternal = false;
  }
  await refreshGitForFile(path);
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
  const normalizeCmp = (p: string) => {
    const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return pathCaseInsensitive ? n.toLowerCase() : n;
  };
  const rootA = normalizeCmp(detail.root);
  const rootB = normalizeCmp(wsRoot);
  if (rootA !== rootB) return;

  const path = currentPath.value.replace(/\\/g, "/");
  const hit = detail.events.find((e) => {
    const ep = e.path.replace(/\\/g, "/");
    return pathCaseInsensitive ? ep.toLowerCase() === path.toLowerCase() : ep === path;
  });
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
      const editorValue = editor?.getValue() ?? liveContent.value;
      if (editorValue === res.content) {
        diskFingerprint = nextFp;
        dirty.value = false;
        syncTabMeta({ dirty: false });
        return;
      }
      // No local edits → silently take disk content (no prompt).
      if (!dirty.value) {
        await applyDiskContentSilently(path, res.content);
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

async function pickFile(): Promise<void> {
  const picked = await window.api.preview.pickFile();
  if (picked) await loadPath(picked);
}

async function save(): Promise<boolean> {
  if (!currentPath.value) return false;
  const wasMissing = missing.value;
  const content =
    editor?.getValue() ??
    (liveContent.value ||
      (result.value?.kind === "text" || result.value?.kind === "markdown"
        ? result.value.content
        : ""));
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

function onPreviewKeydown(event: KeyboardEvent): void {
  if (props.active === false) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.key.toLowerCase() !== "s") return;
  if (event.isComposing) return;
  // Only when this preview can save text content
  if (!(result.value?.kind === "text" || result.value?.kind === "markdown" || missing.value)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  void save();
}

onMounted(() => {
  if (props.tabId) {
    rightTabs.registerSaveHandler(props.tabId, save);
  }
  window.addEventListener("pi-fs-changed", onFsChanged);
  window.addEventListener("keydown", onPreviewKeydown, true);
});

onBeforeUnmount(() => {
  if (props.tabId) rightTabs.unregisterSaveHandler(props.tabId);
  window.removeEventListener("pi-fs-changed", onFsChanged);
  window.removeEventListener("keydown", onPreviewKeydown, true);
  stopMedia();
  unregisterVideo?.();
  unregisterAudio?.();
  unregisterVideo = undefined;
  unregisterAudio = undefined;
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
        <div v-if="isMarkdown" class="md-modes" role="group" :aria-label="t.mdPreview">
          <button
            type="button"
            class="md-mode"
            :class="{ active: mdViewMode === 'edit' }"
            @click="mdViewMode = 'edit'"
          >
            {{ t.mdEdit }}
          </button>
          <button
            type="button"
            class="md-mode"
            :class="{ active: mdViewMode === 'split' }"
            @click="mdViewMode = 'split'"
          >
            {{ t.mdSplit }}
          </button>
          <button
            type="button"
            class="md-mode"
            :class="{ active: mdViewMode === 'preview' }"
            @click="mdViewMode = 'preview'"
          >
            {{ t.mdPreview }}
          </button>
        </div>
        <NButton
          v-if="result?.kind === 'text' || result?.kind === 'markdown' || missing"
          size="tiny"
          quaternary
          :disabled="saving || (!dirty && !missing)"
          :loading="saving"
          :title="t.saveShortcut"
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
          <NAlert
            v-if="missing || result.kind === 'error'"
            type="error"
            :bordered="false"
            style="margin: 4px 8px"
          >
            {{ t.fileDeletedHint }}
          </NAlert>
          <NAlert
            v-else-if="result.kind === 'unsupported'"
            type="warning"
            :bordered="false"
          >
            {{ result.reason === "binary" ? t.previewBinary : t.previewUnsupported }}
          </NAlert>
          <template v-if="result.kind === 'text' || result.kind === 'markdown'">
            <NAlert
              v-if="result.truncated"
              type="warning"
              :bordered="false"
              style="margin: 4px 8px"
            >
              {{ t.previewTruncated }}
            </NAlert>
            <div
              class="doc-body"
              :class="{
                'md-split': isMarkdown && mdViewMode === 'split',
                'md-preview-only': isMarkdown && mdViewMode === 'preview',
              }"
            >
              <div v-show="showEditor" ref="editorHost" class="editor" />
              <div v-if="showMdPreview" class="md-preview">
                <MarkdownView :content="liveContent" />
              </div>
            </div>
          </template>
          <div v-else-if="!missing && result.kind === 'image'" class="media-wrap">
            <img class="img" :src="result.dataUrl" :alt="result.path" />
          </div>
          <div v-else-if="!missing && result.kind === 'video'" class="media-wrap">
            <video
              ref="videoRef"
              class="media-player"
              controls
              preload="metadata"
              :src="result.mediaSrc"
            />
          </div>
          <div v-else-if="!missing && result.kind === 'audio'" class="media-wrap audio-wrap">
            <audio
              ref="audioRef"
              class="media-audio"
              controls
              preload="metadata"
              :src="result.mediaSrc"
            />
          </div>
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
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.md-modes {
  display: inline-flex;
  padding: 1px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
}

.md-mode {
  border: none;
  background: transparent;
  color: var(--fg-muted);
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.md-mode.active {
  background: var(--bg-elevated, var(--bg-panel));
  color: var(--fg-strong);
  font-weight: 550;
}

.md-mode:hover:not(.active) {
  color: var(--fg-strong);
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

.doc-body {
  flex: 1;
  min-height: 0;
  display: flex;
  width: 100%;
  overflow: hidden;
}

.doc-body.md-split .editor {
  flex: 1;
  min-width: 0;
  border-right: 1px solid var(--border);
}

.doc-body.md-split .md-preview {
  flex: 1;
  min-width: 0;
}

.doc-body.md-preview-only .md-preview {
  flex: 1;
}

.editor {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.md-preview {
  overflow: auto;
  padding: 16px 20px 24px;
  background: var(--bg);
}

.img {
  max-width: 100%;
  height: auto;
  display: block;
  margin: 8px;
  border-radius: 4px;
}

.media-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 12px;
  background: var(--bg);
}

.media-wrap.audio-wrap {
  align-items: center;
}

.media-player {
  max-width: 100%;
  max-height: 100%;
  outline: none;
  border-radius: 6px;
  background: #000;
}

.media-audio {
  width: min(480px, 100%);
  outline: none;
}
</style>
