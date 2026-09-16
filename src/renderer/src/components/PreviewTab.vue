<script setup lang="ts">
import type { PreviewResult } from "../../../shared/preview-types";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NAlert, NButton, NEmpty, NIcon, NSpin, NText, useMessage } from "naive-ui";
import { ChatbubbleEllipsesOutline, FolderOpenOutline, SaveOutline } from "@vicons/ionicons5";
import type * as Monaco from "monaco-editor";
import MarkdownView from "@renderer/components/MarkdownView.vue";
import { breadcrumbs, languageFromPath } from "@renderer/utils/editor-lang";
import {
  absoluteWorkspacePath,
  isAbsoluteFsPath,
  isInsideWorkspace,
  normalizeFsPath,
  type FsChangedPayload,
} from "@renderer/utils/fs-changed-bus";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import {
  applyMonacoColorTheme,
  injectEditorStyleOverrides,
  monacoThemeName,
} from "@renderer/utils/monaco-theme";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useLayoutStore } from "@renderer/stores/layout";
import { useMediaStore } from "@renderer/stores/media";
import { useComposerStore } from "@renderer/stores/composer";
import { t } from "@renderer/i18n";

type MdViewMode = "edit" | "preview" | "split";

const props = defineProps<{
  filePath?: string | null;
  tabId?: string;
  active?: boolean;
  /** 智能体设置页内嵌：隐藏「打开文件」等非编辑器控件，markdown 直接以编辑器打开。 */
  embedded?: boolean;
  /** 未落盘的草稿内容（与 filePath 互斥）。 */
  draftContent?: string | null;
  /** 自定义保存：提供后保存按钮与 Ctrl+S 都交给外部处理（内容由外部落盘）。 */
  saveHandler?: (content: string) => Promise<boolean> | boolean;
}>();

const message = useMessage();
const rightTabs = useRightTabsStore();
const appearance = useAppearanceStore();
const layout = useLayoutStore();
const media = useMediaStore();
const composer = useComposerStore();
const workspace = useWorkspaceStore();

/** Floating "add to chat" button state on selection */
const selectionFloater = ref({
  show: false,
  x: 0,
  y: 0,
  startLine: 0,
  endLine: 0,
});
let selectionDebounce: ReturnType<typeof setTimeout> | null = null;
/** Last pointer inside the Monaco surface (viewport coords for fixed floater). */
let lastPointerClient = { x: 0, y: 0, at: 0 };
let detachEditorPointer: (() => void) | null = null;
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
/** 最近一次从磁盘读到的内容 —— 与它不一致即视为外部改动。 */
let diskContent: string | null = null;
let applyingExternal = false;
/** 丢弃过期的读盘结果（外部连续写入时事件可能乱序返回）。 */
let fsGen = 0;
/** 工作区外文件需单独订阅：主进程目录 watcher 只覆盖工作区。 */
let watchedExternalPath: string | null = null;
let stopPreviewWatch: (() => void) | null = null;
let unregisterVideo: (() => void) | undefined;
let unregisterAudio: (() => void) | undefined;

const crumbs = computed(() => (currentPath.value ? breadcrumbs(currentPath.value) : []));
const errorText = computed(() =>
  result.value?.kind === "error" ? result.value.message : t.fileDeletedHint,
);
const isMarkdown = computed(() => result.value?.kind === "markdown");
const showEditor = computed(
  () =>
    (result.value?.kind === "text" || result.value?.kind === "markdown") &&
    (!isMarkdown.value || mdViewMode.value !== "preview"),
);
/** 未落盘草稿：没有磁盘路径但仍需渲染编辑器。 */
const isDraft = computed(() => !props.filePath && props.draftContent != null);
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

function disposeEditor(): void {
  detachEditorPointer?.();
  editor?.dispose();
  editor = null;
}

function hideSelectionFloater(): void {
  if (selectionDebounce) {
    clearTimeout(selectionDebounce);
    selectionDebounce = null;
  }
  if (selectionFloater.value.show) selectionFloater.value.show = false;
}

function onEditorSelectionChange(_e: Monaco.editor.ICursorSelectionChangedEvent): void {
  if (!editor || !monacoApi) return;
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    hideSelectionFloater();
    return;
  }
  // While dragging, only track range; show the chip on pointerup (more reliable than
  // selection+scroll races — Monaco often fires scroll during select and used to
  // cancel the pending show).
  if (selectionDebounce) clearTimeout(selectionDebounce);
  selectionDebounce = setTimeout(() => {
    selectionDebounce = null;
    // Keyboard / programmatic selections still need a chip without pointerup.
    if (Date.now() - lastPointerClient.at > 400) {
      showFloaterNearPointer(
        selection.startLineNumber,
        selection.endLineNumber,
        selection.endColumn,
      );
    }
  }, 120);
}

function clientPointFromSelectionEnd(endLine: number, endColumn: number): { x: number; y: number } | null {
  if (!editor) return null;
  try {
    const pos = editor.getScrolledVisiblePosition({ lineNumber: endLine, column: endColumn });
    const dom = editor.getDomNode();
    if (!pos || !dom) return null;
    const rect = dom.getBoundingClientRect();
    return {
      x: rect.left + pos.left,
      y: rect.top + pos.top + pos.height,
    };
  } catch {
    return null;
  }
}

function clampFloaterPoint(x: number, y: number): { x: number; y: number } {
  const pad = 8;
  const approxW = 148;
  const approxH = 32;
  return {
    x: Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - approxW - pad)),
    y: Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - approxH - pad)),
  };
}

/** Prefer recent mouse position; fall back to selection caret for keyboard selects. */
function showFloaterNearPointer(_startLine: number, endLine: number, endColumn: number): void {
  if (!editor || !monacoApi) return;
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) {
    hideSelectionFloater();
    return;
  }
  const pointerFresh = Date.now() - lastPointerClient.at < 1000;
  const fromCaret = clientPointFromSelectionEnd(endLine, endColumn);
  const rawX = pointerFresh
    ? lastPointerClient.x + 12
    : (fromCaret?.x ?? lastPointerClient.x) + 8;
  const rawY = pointerFresh
    ? lastPointerClient.y + 12
    : (fromCaret?.y ?? lastPointerClient.y) + 8;
  const { x, y } = clampFloaterPoint(rawX, rawY);
  selectionFloater.value = {
    show: true,
    x,
    y,
    startLine: selection.startLineNumber,
    endLine: selection.endLineNumber,
  };
}

function tryShowFloaterAfterPointerUp(): void {
  if (!editor) return;
  // Let Monaco finish applying the selection from this pointerup.
  requestAnimationFrame(() => {
    const selection = editor?.getSelection();
    if (!selection || selection.isEmpty()) {
      hideSelectionFloater();
      return;
    }
    showFloaterNearPointer(
      selection.startLineNumber,
      selection.endLineNumber,
      selection.endColumn,
    );
  });
}

function bindEditorPointerTracking(dom: HTMLElement): void {
  detachEditorPointer?.();
  const onMove = (e: PointerEvent) => {
    lastPointerClient = { x: e.clientX, y: e.clientY, at: Date.now() };
  };
  const onUp = (e: PointerEvent) => {
    lastPointerClient = { x: e.clientX, y: e.clientY, at: Date.now() };
    tryShowFloaterAfterPointerUp();
  };
  // Capture on host: Monaco routes events through nested nodes.
  dom.addEventListener("pointermove", onMove, true);
  dom.addEventListener("pointerup", onUp, true);
  detachEditorPointer = () => {
    dom.removeEventListener("pointermove", onMove, true);
    dom.removeEventListener("pointerup", onUp, true);
    detachEditorPointer = null;
  };
}

function addToChatFromSelection(): void {
  if (!currentPath.value) return;
  const { startLine, endLine } = selectionFloater.value;
  const relPath = workspaceRelativePath(currentPath.value);
  composer.addFileTag(relPath, startLine, endLine);
  hideSelectionFloater();
  message.success(t.filesCited);
  // Clear the selection so the floater goes away cleanly
  editor?.setSelection(new monacoApi!.Range(1, 1, 1, 1));
}

function workspaceRelativePath(absPath: string): string {
  const raw = absPath.replace(/\\/g, "/");
  const root = (workspace.root || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return raw;
  const pathFold = raw.toLowerCase();
  const rootFold = root.toLowerCase();
  if (pathFold === rootFold) return "";
  if (pathFold.startsWith(`${rootFold}/`)) return raw.slice(root.length + 1);
  return raw;
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
    diskContent = content;
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
    const dark = appearance.resolvedTheme === "dark";
    applyMonacoColorTheme(monaco, dark);
    editor = monaco.editor.create(editorHost.value, {
      value: content,
      language,
      theme: monacoThemeName(dark),
      // 关闭 shadow DOM，让右键菜单/滚动区域进入文档流，自定义外观的半透明样式才能生效
      useShadowDOM: false,
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
      hover: { enabled: "on" },
    });
    injectEditorStyleOverrides(editor.getDomNode());
    editor.onDidChangeModelContent(() => {
      liveContent.value = editor?.getValue() ?? "";
      if (applyingExternal) return;
      dirty.value = true;
      syncTabMeta({ dirty: true });
    });
    editor.onDidChangeCursorSelection(onEditorSelectionChange);
    const dom = editor.getDomNode();
    if (dom) {
      bindEditorPointerTracking(dom);
      // Wheel / intentional scroll dismisses the chip; ignore tiny layout scrolls during select.
      dom.addEventListener("wheel", () => hideSelectionFloater(), { passive: true });
    }
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
  diskContent = content;
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
    const rel = normalizeFsPath(workspaceRelativePath(path));
    const hit = status.files.find((f) => normalizeFsPath(f.relativePath) === rel);
    syncTabMeta({ gitCode: hit?.code });
  } catch {
    // ignore
  }
}

/** 加载未落盘草稿：无磁盘路径，始终视为未保存。 */
async function loadDraft(content: string): Promise<void> {
  loadGen += 1;
  fsGen += 1;
  currentPath.value = null;
  result.value = { kind: "markdown", path: "", content };
  liveContent.value = content;
  missing.value = false;
  mdViewMode.value = "edit";
  await ensureEditor(content, "markdown");
  dirty.value = true;
  syncTabMeta({ dirty: true });
}

async function loadPath(path: string | null): Promise<void> {
  const gen = ++loadGen;
  fsGen += 1;
  currentPath.value = path;
  dirty.value = false;
  missing.value = false;
  diskContent = null;
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
        mdViewMode.value = props.embedded ? "edit" : "preview";
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
  // loadPath 内部会切模式并自行装载内容，避免用尚未就绪的 liveContent 覆盖
  if (loading.value || !isMarkdown.value || !currentPath.value) return;
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
      hideSelectionFloater();
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

/** 用磁盘内容整体替换模型：保留撤销栈，外部改动可 Ctrl+Z 回退。 */
function applyExternalContent(content: string): void {
  if (!editor || !monacoApi) return;
  const model = editor.getModel();
  if (!model || model.getValue() === content) return;
  const selection = editor.getSelection();
  editor.pushUndoStop();
  editor.executeEdits("external", [{ range: model.getFullModelRange(), text: content }]);
  editor.pushUndoStop();
  if (selection) {
    const start = clampPosition(model, selection.getStartPosition());
    const end = clampPosition(model, selection.getEndPosition());
    editor.setSelection(
      new monacoApi.Selection(start.lineNumber, start.column, end.lineNumber, end.column),
    );
  }
}

function clampPosition(
  model: Monaco.editor.ITextModel,
  pos: Monaco.IPosition,
): Monaco.IPosition {
  const lineNumber = Math.min(Math.max(1, pos.lineNumber), model.getLineCount());
  return { lineNumber, column: Math.min(pos.column, model.getLineMaxColumn(lineNumber)) };
}

async function applyDiskContentSilently(path: string, content: string): Promise<void> {
  applyingExternal = true;
  try {
    if (editor && editorHostIsLive()) {
      applyExternalContent(content);
    }
    liveContent.value = content;
    diskContent = content;
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

/** 读盘比对后刷新编辑器：工作区内外的变更都走这里。 */
function refreshFromDisk(path: string): void {
  void (async () => {
    const gen = ++fsGen;
    const res = await window.api.preview.read(path);
    if (gen !== fsGen) return;
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
    if (diskContent !== null && diskContent === res.content) return;
    // 自己的保存也会触发 fs watch —— 编辑器与磁盘一致时只同步状态
    const editorValue = editor?.getValue() ?? liveContent.value;
    if (editorValue === res.content) {
      diskContent = res.content;
      dirty.value = false;
      syncTabMeta({ dirty: false });
      return;
    }
    await applyDiskContentSilently(path, res.content);
  })();
}

function onFsChanged(event: Event): void {
  const detail = (event as CustomEvent<FsChangedPayload>).detail;
  const path = currentPath.value;
  if (!detail || !path) return;
  const target = normalizeFsPath(absoluteWorkspacePath(detail.root, path));
  const hit = detail.events.find(
    (e) => normalizeFsPath(absoluteWorkspacePath(detail.root, e.path)) === target,
  );
  if (hit) refreshFromDisk(path);
}

/** 工作区外文件不在全局 watcher 范围内，按标签页订阅其所在目录。 */
function syncExternalFileWatch(): void {
  const root = workspace.root ?? "";
  const path = currentPath.value;
  const next =
    path && isAbsoluteFsPath(path) && !isInsideWorkspace(root, path) ? path : null;
  if (next === watchedExternalPath) return;
  if (watchedExternalPath) void window.api.preview.unwatch(watchedExternalPath);
  watchedExternalPath = next;
  if (next) void window.api.preview.watch(next);
}

function onExternalWatchChanged(payload: { paths: string[] }): void {
  const path = currentPath.value;
  if (!path || !payload?.paths?.length) return;
  const target = normalizeFsPath(path);
  if (payload.paths.some((p) => normalizeFsPath(p) === target)) refreshFromDisk(path);
}

watch(currentPath, () => syncExternalFileWatch());

watch(
  [() => props.filePath, () => props.draftContent],
  () => {
    if (!props.filePath && props.draftContent != null) {
      void loadDraft(props.draftContent);
      return;
    }
    void loadPath(props.filePath ?? null);
  },
  { immediate: true },
);

async function pickFile(): Promise<void> {
  const picked = await window.api.preview.pickFile();
  if (picked) await loadPath(picked);
}

async function save(): Promise<boolean> {
  if (saving.value) return false;
  if (props.saveHandler) {
    const content =
      editor?.getValue() ??
      (liveContent.value ||
        (result.value?.kind === "text" || result.value?.kind === "markdown"
          ? result.value.content
          : ""));
    saving.value = true;
    try {
      const ok = await props.saveHandler(content);
      if (ok) {
        diskContent = content;
        dirty.value = false;
        missing.value = false;
        syncTabMeta({ dirty: false, missing: false });
      }
      return ok;
    } finally {
      saving.value = false;
    }
  }
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
      diskContent = content;
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

function getContent(): string {
  return editor?.getValue() ?? liveContent.value ?? "";
}

function setContent(content: string): void {
  const model = editor?.getModel();
  if (model && model.getValue() !== content) {
    editor?.pushUndoStop();
    model.setValue(content);
    editor?.pushUndoStop();
  }
  liveContent.value = content;
}

defineExpose({ save, dirty, getContent, setContent });

/** Ctrl+S 按住期间只保存一次（不依赖系统 repeat 标记）。 */
let saveShortcutHeld = false;

function onPreviewKeydown(event: KeyboardEvent): void {
  if (props.active === false) return;
  // 右侧面板被折起或被设置页覆盖时，不参与全局快捷键
  if (!props.embedded && (layout.rightCollapsed || layout.centerView === "customize")) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.key.toLowerCase() !== "s") return;
  if (event.isComposing) return;
  // Only when this preview can save text content
  if (!(result.value?.kind === "text" || result.value?.kind === "markdown" || missing.value)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  // 长按不重复触发保存
  if (event.repeat || saveShortcutHeld) return;
  saveShortcutHeld = true;
  void save();
}

function onPreviewKeyup(event: KeyboardEvent): void {
  if (event.key.toLowerCase() === "s") saveShortcutHeld = false;
}

function onWindowBlur(): void {
  saveShortcutHeld = false;
}

onMounted(() => {
  if (props.tabId) {
    rightTabs.registerSaveHandler(props.tabId, save);
  }
  window.addEventListener("pi-fs-changed", onFsChanged);
  stopPreviewWatch = window.api.preview.onChanged(onExternalWatchChanged);
  window.addEventListener("keydown", onPreviewKeydown, true);
  window.addEventListener("keyup", onPreviewKeyup, true);
  window.addEventListener("blur", onWindowBlur);
});

onBeforeUnmount(() => {
  if (props.tabId) rightTabs.unregisterSaveHandler(props.tabId);
  window.removeEventListener("pi-fs-changed", onFsChanged);
  stopPreviewWatch?.();
  stopPreviewWatch = null;
  if (watchedExternalPath) {
    void window.api.preview.unwatch(watchedExternalPath);
    watchedExternalPath = null;
  }
  window.removeEventListener("keydown", onPreviewKeydown, true);
  window.removeEventListener("keyup", onPreviewKeyup, true);
  window.removeEventListener("blur", onWindowBlur);
  if (selectionDebounce) clearTimeout(selectionDebounce);
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
    <div v-if="!embedded" class="toolbar">
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
        <div v-if="isMarkdown && !embedded" class="md-modes" role="group" :aria-label="t.mdPreview">
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
        <NButton v-if="!embedded" size="tiny" quaternary @click="pickFile">
          <template #icon>
            <NIcon :component="FolderOpenOutline" :size="14" />
          </template>
          {{ t.openFileEllipsis }}
        </NButton>
      </div>
    </div>
    <div class="viewport">
      <Teleport to="body">
        <!-- Fixed chip near pointer; teleported so overflow:hidden parents cannot clip it -->
        <button
          v-if="selectionFloater.show && active !== false"
          type="button"
          class="selection-floater"
          :style="{ left: `${selectionFloater.x}px`, top: `${selectionFloater.y}px` }"
          :title="t.selectionAddToChat"
          @mousedown.prevent="addToChatFromSelection"
        >
          <NIcon :component="ChatbubbleEllipsesOutline" :size="14" />
          <span>{{ t.selectionAddToChat }}</span>
        </button>
      </Teleport>
      <NEmpty v-if="!currentPath && !isDraft" :description="t.previewHint" size="small" />
      <NSpin v-else :show="loading" class="spin">
        <template v-if="result">
          <NAlert
            v-if="missing || result.kind === 'error'"
            type="error"
            :bordered="false"
            style="margin: 4px 8px"
          >
            {{ errorText }}
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

.selection-floater {
  position: fixed;
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--accent-border, color-mix(in srgb, var(--primary, #3b82f6) 35%, var(--border, #ddd)));
  border-radius: 6px;
  background: color-mix(in srgb, var(--primary, #3b82f6) 14%, var(--bg-panel, #fff));
  color: var(--primary, #3b82f6);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  transition: background 0.12s ease, transform 0.12s ease;
}

.selection-floater:hover {
  background: color-mix(in srgb, var(--primary, #3b82f6) 24%, var(--bg-panel, #fff));
  transform: translateY(-1px);
}

.selection-floater:active {
  transform: scale(0.98);
}
</style>
