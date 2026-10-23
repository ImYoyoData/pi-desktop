import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Empty, Spin, Typography } from "antd";
import {
  ChatbubbleEllipsesOutline,
  FolderOpenOutline,
  SaveOutline,
} from "@renderer/components/icons/ionicons";
import type * as Monaco from "monaco-editor";
import type { PreviewResult } from "../../../shared/preview-types";
import MarkdownView from "@renderer/components/MarkdownView";
import { breadcrumbs, languageFromPath } from "@renderer/utils/editor-lang";
import {
  absoluteWorkspacePath,
  isAbsoluteFsPath,
  isInsideWorkspace,
  normalizeFsPath,
  type FsChangedPayload,
} from "@renderer/utils/fs-changed-bus";
import { loadMonaco } from "@renderer/utils/monaco-loader";
import { parentDir } from "@renderer/utils/fs-path";
import type { MarkdownAssetBase } from "@renderer/utils/markdown-assets";
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
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PreviewTab.module.css";

type MdViewMode = "edit" | "preview" | "split";

type Props = {
  filePath?: string | null;
  tabId?: string;
  active?: boolean;
  /** 智能体设置页内嵌：隐藏「打开文件」等非编辑器控件，markdown 直接以编辑器打开。 */
  embedded?: boolean;
  /** 未落盘的草稿内容（与 filePath 互斥）。 */
  draftContent?: string | null;
  /** 自定义保存：提供后保存按钮与 Ctrl+S 都交给外部处理（内容由外部落盘）。 */
  saveHandler?: (content: string) => Promise<boolean> | boolean;
};

export type PreviewTabHandle = {
  save: () => Promise<boolean>;
  dirty: boolean;
  getContent: () => string;
  setContent: (content: string) => void;
};

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export const PreviewTab = forwardRef<PreviewTabHandle, Props>(function PreviewTab(
  {
    filePath,
    tabId,
    active,
    embedded = false,
    draftContent,
    saveHandler,
  }: Props,
  ref,
): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const appearance = useAppearanceStore();
  const layout = useLayoutStore();

  const [selectionFloater, setSelectionFloater] = useState({
    show: false,
    x: 0,
    y: 0,
    startLine: 0,
    endLine: 0,
  });
  const [currentPath, setCurrentPath] = useState<string | null>(filePath ?? null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [liveContent, setLiveContent] = useState("");
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>("preview");

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const monacoApiRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const loadGenRef = useRef(0);
  const diskContentRef = useRef<string | null>(null);
  const applyingExternalRef = useRef(false);
  const fsGenRef = useRef(0);
  const watchedExternalPathRef = useRef<string | null>(null);
  const stopPreviewWatchRef = useRef<(() => void) | null>(null);
  const unregisterVideoRef = useRef<(() => void) | undefined>(undefined);
  const unregisterAudioRef = useRef<(() => void) | undefined>(undefined);
  const selectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerClientRef = useRef({ x: 0, y: 0, at: 0 });
  const detachEditorPointerRef = useRef<(() => void) | null>(null);
  const saveShortcutHeldRef = useRef(false);
  const activeRef = useRef(active);
  const embeddedRef = useRef(embedded);
  const currentPathRef = useRef(currentPath);
  const resultRef = useRef(result);
  const liveContentRef = useRef(liveContent);
  const missingRef = useRef(missing);
  const savingRef = useRef(saving);
  const saveHandlerRef = useRef(saveHandler);
  activeRef.current = active;
  embeddedRef.current = embedded;
  currentPathRef.current = currentPath;
  resultRef.current = result;
  liveContentRef.current = liveContent;
  missingRef.current = missing;
  savingRef.current = saving;
  saveHandlerRef.current = saveHandler;

  const isMarkdown = result?.kind === "markdown";
  const isDraft = !filePath && draftContent != null;
  const showEditor =
    (result?.kind === "text" || result?.kind === "markdown") &&
    (!isMarkdown || mdViewMode !== "preview");
  const showMdPreview = isMarkdown && mdViewMode !== "edit";
  const mediaVisible = Boolean(active) && !layout.rightCollapsed;
  const mediaIdPrefix = `preview:${tabId ?? "anon"}:`;
  const crumbs = currentPath ? breadcrumbs(currentPath) : [];
  const errorText =
    result?.kind === "error" ? result.message : t.fileDeletedHint;

  /** 相对路径图片按文档所在目录解析。 */
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const mdAssets = useMemo<MarkdownAssetBase | null>(() => {
    if (!currentPath) return null;
    const root = workspaceRoot ?? "";
    if (!root && !isAbsoluteFsPath(currentPath)) return null;
    const absolute = absoluteWorkspacePath(root, currentPath);
    return { dir: parentDir(absolute), root: root || null };
  }, [currentPath, workspaceRoot]);

  function stopMedia(): void {
    useMediaStore.getState().stopByPrefix(mediaIdPrefix);
  }

  function syncMediaRegistration(): void {
    unregisterVideoRef.current?.();
    unregisterAudioRef.current?.();
    unregisterVideoRef.current = undefined;
    unregisterAudioRef.current = undefined;
    const store = useMediaStore.getState();
    if (videoRef.current) {
      unregisterVideoRef.current = store.register(`${mediaIdPrefix}video`, videoRef.current);
    }
    if (audioRef.current) {
      unregisterAudioRef.current = store.register(`${mediaIdPrefix}audio`, audioRef.current);
    }
  }

  function syncTabMeta(patch: { dirty?: boolean; missing?: boolean; gitCode?: string }): void {
    if (!tabId) return;
    useRightTabsStore.getState().patchTab(tabId, patch);
  }

  function disposeEditor(): void {
    detachEditorPointerRef.current?.();
    editorRef.current?.dispose();
    editorRef.current = null;
  }

  function hideSelectionFloater(): void {
    if (selectionDebounceRef.current) {
      clearTimeout(selectionDebounceRef.current);
      selectionDebounceRef.current = null;
    }
    setSelectionFloater((current) => (current.show ? { ...current, show: false } : current));
  }

  function workspaceRelativePath(absPath: string): string {
    const raw = absPath.replace(/\\/g, "/");
    const root = (useWorkspaceStore.getState().root || "")
      .replace(/\\/g, "/")
      .replace(/\/+$/, "");
    if (!root) return raw;
    const pathFold = raw.toLowerCase();
    const rootFold = root.toLowerCase();
    if (pathFold === rootFold) return "";
    if (pathFold.startsWith(`${rootFold}/`)) return raw.slice(root.length + 1);
    return raw;
  }

  function clientPointFromSelectionEnd(
    endLine: number,
    endColumn: number,
  ): { x: number; y: number } | null {
    const editor = editorRef.current;
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

  function showFloaterNearPointer(
    _startLine: number,
    endLine: number,
    endColumn: number,
  ): void {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      hideSelectionFloater();
      return;
    }
    const pointer = lastPointerClientRef.current;
    const pointerFresh = Date.now() - pointer.at < 1000;
    const fromCaret = clientPointFromSelectionEnd(endLine, endColumn);
    const rawX = pointerFresh ? pointer.x + 12 : (fromCaret?.x ?? pointer.x) + 8;
    const rawY = pointerFresh ? pointer.y + 12 : (fromCaret?.y ?? pointer.y) + 8;
    const { x, y } = clampFloaterPoint(rawX, rawY);
    setSelectionFloater({
      show: true,
      x,
      y,
      startLine: selection.startLineNumber,
      endLine: selection.endLineNumber,
    });
  }

  function onEditorSelectionChange(): void {
    const editor = editorRef.current;
    if (!editor || !monacoApiRef.current) return;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      hideSelectionFloater();
      return;
    }
    if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current);
    selectionDebounceRef.current = setTimeout(() => {
      selectionDebounceRef.current = null;
      if (Date.now() - lastPointerClientRef.current.at > 400) {
        showFloaterNearPointer(
          selection.startLineNumber,
          selection.endLineNumber,
          selection.endColumn,
        );
      }
    }, 120);
  }

  function tryShowFloaterAfterPointerUp(): void {
    const editor = editorRef.current;
    if (!editor) return;
    requestAnimationFrame(() => {
      const current = editorRef.current;
      const selection = current?.getSelection();
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
    detachEditorPointerRef.current?.();
    const onMove = (event: PointerEvent): void => {
      lastPointerClientRef.current = {
        x: event.clientX,
        y: event.clientY,
        at: Date.now(),
      };
    };
    const onUp = (event: PointerEvent): void => {
      lastPointerClientRef.current = {
        x: event.clientX,
        y: event.clientY,
        at: Date.now(),
      };
      tryShowFloaterAfterPointerUp();
    };
    dom.addEventListener("pointermove", onMove, true);
    dom.addEventListener("pointerup", onUp, true);
    detachEditorPointerRef.current = () => {
      dom.removeEventListener("pointermove", onMove, true);
      dom.removeEventListener("pointerup", onUp, true);
      detachEditorPointerRef.current = null;
    };
  }

  function addToChatFromSelection(): void {
    const path = currentPathRef.current;
    if (!path) return;
    const { startLine, endLine } = selectionFloater;
    const relPath = workspaceRelativePath(path);
    useComposerStore.getState().addFileTag(relPath, startLine, endLine);
    hideSelectionFloater();
    message.success(t.filesCited);
    const monaco = monacoApiRef.current;
    editorRef.current?.setSelection(new monaco!.Range(1, 1, 1, 1));
  }

  function editorHostIsLive(): boolean {
    const editor = editorRef.current;
    const host = editorHostRef.current;
    if (!editor || !host) return false;
    const dom = editor.getDomNode();
    return Boolean(dom && host.contains(dom));
  }

  async function ensureEditor(content: string, language: string): Promise<void> {
    await nextFrame();
    const host = editorHostRef.current;
    if (!host) {
      setLiveContent(content);
      diskContentRef.current = content;
      setDirty(false);
      setMissing(false);
      syncTabMeta({ dirty: false, missing: false });
      return;
    }
    if (editorRef.current && !editorHostIsLive()) {
      disposeEditor();
    }
    if (!monacoApiRef.current) monacoApiRef.current = await loadMonaco();
    const monaco = monacoApiRef.current;
    applyingExternalRef.current = true;
    if (!editorRef.current) {
      const dark = useAppearanceStore.getState().resolvedTheme === "dark";
      applyMonacoColorTheme(monaco, dark);
      const editor = monaco.editor.create(host, {
        value: content,
        language,
        theme: monacoThemeName(dark),
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
        hover: { enabled: "on" },
      });
      editorRef.current = editor;
      injectEditorStyleOverrides(editor.getDomNode());
      editor.onDidChangeModelContent(() => {
        setLiveContent(editorRef.current?.getValue() ?? "");
        if (applyingExternalRef.current) return;
        setDirty(true);
        syncTabMeta({ dirty: true });
      });
      editor.onDidChangeCursorSelection(onEditorSelectionChange);
      const dom = editor.getDomNode();
      if (dom) {
        bindEditorPointerTracking(dom);
        dom.addEventListener("wheel", () => hideSelectionFloater(), { passive: true });
      }
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void save();
      });
    } else {
      const model = editorRef.current.getModel();
      if (model) {
        monaco.editor.setModelLanguage(model, language);
        if (model.getValue() !== content) {
          editorRef.current.pushUndoStop();
          model.setValue(content);
          editorRef.current.pushUndoStop();
        }
      }
    }
    setLiveContent(content);
    diskContentRef.current = content;
    setDirty(false);
    setMissing(false);
    syncTabMeta({ dirty: false, missing: false });
    applyingExternalRef.current = false;
    await nextFrame();
    editorRef.current?.layout();
  }

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

  async function loadDraft(content: string): Promise<void> {
    loadGenRef.current += 1;
    fsGenRef.current += 1;
    setCurrentPath(null);
    setResult({ kind: "markdown", path: "", content });
    setLiveContent(content);
    setMissing(false);
    setMdViewMode("edit");
    await ensureEditor(content, "markdown");
    setDirty(true);
    syncTabMeta({ dirty: true });
  }

  async function loadPath(path: string | null): Promise<void> {
    const gen = ++loadGenRef.current;
    fsGenRef.current += 1;
    setCurrentPath(path);
    setDirty(false);
    setMissing(false);
    diskContentRef.current = null;
    if (!path) {
      setResult(null);
      setLiveContent("");
      disposeEditor();
      syncTabMeta({ dirty: false, missing: false });
      return;
    }
    setLoading(true);
    try {
      const next = await window.api.preview.read(path);
      if (gen !== loadGenRef.current) return;

      if (next.kind === "error") {
        const current = resultRef.current;
        const hadCachedDoc =
          (current?.kind === "text" || current?.kind === "markdown") &&
          Boolean(liveContentRef.current || editorRef.current);
        if (hadCachedDoc) {
          setMissing(true);
          syncTabMeta({ missing: true });
          return;
        }
        setResult(next);
        disposeEditor();
        setLiveContent("");
        setMissing(true);
        syncTabMeta({ missing: true, dirty: false });
        return;
      }

      const prevKind = resultRef.current?.kind;
      const nextIsEditor = next.kind === "text" || next.kind === "markdown";
      const prevIsEditor = prevKind === "text" || prevKind === "markdown";
      if (editorRef.current && (!nextIsEditor || !prevIsEditor)) {
        disposeEditor();
      }

      setResult(next);
      setMissing(false);
      syncTabMeta({ missing: false });
      await nextFrame();
      if (gen !== loadGenRef.current) return;

      if (next.kind === "text" || next.kind === "markdown") {
        setMdViewMode(next.kind === "markdown" ? (embedded ? "edit" : "preview") : "edit");
        await nextFrame();
        if (gen !== loadGenRef.current) return;
        await ensureEditor(next.content, languageFromPath(path));
      } else {
        stopMedia();
        disposeEditor();
        setLiveContent("");
        syncTabMeta({ dirty: false });
      }
      await refreshGitForFile(path);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }

  function clampPosition(
    model: Monaco.editor.ITextModel,
    pos: Monaco.IPosition,
  ): Monaco.IPosition {
    const lineNumber = Math.min(Math.max(1, pos.lineNumber), model.getLineCount());
    return { lineNumber, column: Math.min(pos.column, model.getLineMaxColumn(lineNumber)) };
  }

  function applyExternalContent(content: string): void {
    const editor = editorRef.current;
    const monaco = monacoApiRef.current;
    if (!editor || !monaco) return;
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
        new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column),
      );
    }
  }

  async function applyDiskContentSilently(path: string, content: string): Promise<void> {
    applyingExternalRef.current = true;
    try {
      if (editorRef.current && editorHostIsLive()) {
        applyExternalContent(content);
      }
      setLiveContent(content);
      diskContentRef.current = content;
      setDirty(false);
      setMissing(false);
      setResult((current) =>
        current && (current.kind === "text" || current.kind === "markdown")
          ? { ...current, content }
          : current,
      );
      syncTabMeta({ dirty: false, missing: false });
    } finally {
      applyingExternalRef.current = false;
    }
    await refreshGitForFile(path);
  }

  function refreshFromDisk(path: string): void {
    void (async () => {
      const gen = ++fsGenRef.current;
      const res = await window.api.preview.read(path);
      if (gen !== fsGenRef.current) return;
      if (res.kind === "error") {
        setMissing(true);
        syncTabMeta({ missing: true });
        return;
      }
      if (missingRef.current) {
        setMissing(false);
        syncTabMeta({ missing: false });
      }
      if (res.kind !== "text" && res.kind !== "markdown") return;
      if (diskContentRef.current !== null && diskContentRef.current === res.content) return;
      const editorValue = editorRef.current?.getValue() ?? liveContentRef.current;
      if (editorValue === res.content) {
        diskContentRef.current = res.content;
        setDirty(false);
        syncTabMeta({ dirty: false });
        return;
      }
      await applyDiskContentSilently(path, res.content);
    })();
  }

  function onFsChanged(event: Event): void {
    const detail = (event as CustomEvent<FsChangedPayload>).detail;
    const path = currentPathRef.current;
    if (!detail || !path) return;
    const target = normalizeFsPath(absoluteWorkspacePath(detail.root, path));
    const hit = detail.events.find(
      (e) => normalizeFsPath(absoluteWorkspacePath(detail.root, e.path)) === target,
    );
    if (hit) refreshFromDisk(path);
  }

  function syncExternalFileWatch(): void {
    const root = useWorkspaceStore.getState().root ?? "";
    const path = currentPathRef.current;
    const next =
      path && isAbsoluteFsPath(path) && !isInsideWorkspace(root, path) ? path : null;
    if (next === watchedExternalPathRef.current) return;
    if (watchedExternalPathRef.current) {
      void window.api.preview.unwatch(watchedExternalPathRef.current);
    }
    watchedExternalPathRef.current = next;
    if (next) void window.api.preview.watch(next);
  }

  function onExternalWatchChanged(payload: { paths: string[] }): void {
    const path = currentPathRef.current;
    if (!path || !payload?.paths?.length) return;
    const target = normalizeFsPath(path);
    if (payload.paths.some((p) => normalizeFsPath(p) === target)) refreshFromDisk(path);
  }

  async function pickFile(): Promise<void> {
    const picked = await window.api.preview.pickFile();
    if (picked) await loadPath(picked);
  }

  async function save(): Promise<boolean> {
    if (savingRef.current) return false;
    const handler = saveHandlerRef.current;
    if (handler) {
      const current = resultRef.current;
      const content =
        editorRef.current?.getValue() ??
        (liveContentRef.current ||
          (current?.kind === "text" || current?.kind === "markdown" ? current.content : ""));
      setSaving(true);
      try {
        const ok = await handler(content);
        if (ok) {
          diskContentRef.current = content;
          setDirty(false);
          setMissing(false);
          syncTabMeta({ dirty: false, missing: false });
        }
        return ok;
      } finally {
        setSaving(false);
      }
    }
    const path = currentPathRef.current;
    if (!path) return false;
    const wasMissing = missingRef.current;
    const current = resultRef.current;
    const content =
      editorRef.current?.getValue() ??
      (liveContentRef.current ||
        (current?.kind === "text" || current?.kind === "markdown" ? current.content : ""));
    if (!editorRef.current && content === "" && !wasMissing) return false;

    setSaving(true);
    try {
      await window.api.preview.write(path, content);
      if (wasMissing || !editorRef.current) {
        await loadPath(path);
      } else {
        diskContentRef.current = content;
        setDirty(false);
        setMissing(false);
        syncTabMeta({ dirty: false, missing: false });
        await refreshGitForFile(path);
      }
      message.success(wasMissing ? t.recreatedAndSaved : t.saved);
      return true;
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  function getContent(): string {
    return editorRef.current?.getValue() ?? liveContent ?? "";
  }

  function setContent(content: string): void {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (model && model.getValue() !== content) {
      editor?.pushUndoStop();
      model.setValue(content);
      editor?.pushUndoStop();
    }
    setLiveContent(content);
  }

  useImperativeHandle(ref, () => ({
    save,
    get dirty(): boolean {
      return dirty;
    },
    getContent,
    setContent,
  }));

  function onPreviewKeydown(event: KeyboardEvent): void {
    if (activeRef.current === false) return;
    const layoutState = useLayoutStore.getState();
    if (!embeddedRef.current && (layoutState.rightCollapsed || layoutState.centerView === "customize")) {
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== "s") return;
    if (event.isComposing) return;
    const kind = resultRef.current?.kind;
    if (!(kind === "text" || kind === "markdown" || missingRef.current)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || saveShortcutHeldRef.current) return;
    saveShortcutHeldRef.current = true;
    void save();
  }

  function onPreviewKeyup(event: KeyboardEvent): void {
    if (event.key.toLowerCase() === "s") saveShortcutHeldRef.current = false;
  }

  function onWindowBlur(): void {
    saveShortcutHeldRef.current = false;
  }

  useEffect(() => {
    if (!filePath && draftContent != null) {
      void loadDraft(draftContent);
      return;
    }
    void loadPath(filePath ?? null);
  }, [filePath, draftContent]);

  useEffect(() => {
    const monaco = monacoApiRef.current;
    const editor = editorRef.current;
    if (!monaco || !editor) return;
    applyMonacoColorTheme(monaco, appearance.resolvedTheme === "dark");
  }, [appearance.resolvedTheme]);

  useEffect(() => {
    if (active && currentPathRef.current) {
      void refreshGitForFile(currentPathRef.current);
      void nextFrame().then(() => editorRef.current?.layout());
    } else {
      hideSelectionFloater();
      stopMedia();
    }
  }, [active]);

  useEffect(() => {
    if (useLayoutStore.getState().rightCollapsed) stopMedia();
  }, [layout.rightCollapsed]);

  useEffect(() => {
    if (!mediaVisible) stopMedia();
  }, [mediaVisible]);

  useEffect(() => {
    syncMediaRegistration();
  }, [result?.kind, tabId]);

  useEffect(() => {
    if (loading || !isMarkdown || !currentPath) return;
    void (async () => {
      await nextFrame();
      if (!editorRef.current && showEditor) {
        await ensureEditor(liveContent, languageFromPath(currentPath));
      } else {
        editorRef.current?.layout();
      }
    })();
  }, [mdViewMode]);

  useEffect(() => {
    syncExternalFileWatch();
  }, [currentPath]);

  useEffect(() => {
    if (!tabId) return;
    useRightTabsStore.getState().registerSaveHandler(tabId, save);
    window.addEventListener("pi-fs-changed", onFsChanged);
    stopPreviewWatchRef.current = window.api.preview.onChanged(onExternalWatchChanged);
    window.addEventListener("keydown", onPreviewKeydown, true);
    window.addEventListener("keyup", onPreviewKeyup, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      if (tabId) useRightTabsStore.getState().unregisterSaveHandler(tabId);
      window.removeEventListener("pi-fs-changed", onFsChanged);
      stopPreviewWatchRef.current?.();
      stopPreviewWatchRef.current = null;
      if (watchedExternalPathRef.current) {
        void window.api.preview.unwatch(watchedExternalPathRef.current);
        watchedExternalPathRef.current = null;
      }
      window.removeEventListener("keydown", onPreviewKeydown, true);
      window.removeEventListener("keyup", onPreviewKeyup, true);
      window.removeEventListener("blur", onWindowBlur);
      if (selectionDebounceRef.current) clearTimeout(selectionDebounceRef.current);
      stopMedia();
      unregisterVideoRef.current?.();
      unregisterAudioRef.current?.();
      unregisterVideoRef.current = undefined;
      unregisterAudioRef.current = undefined;
      disposeEditor();
    };
  }, [tabId]);

  const floater = selectionFloater.show && active !== false;

  return (
    <div className={styles.previewTab}>
      {embedded ? null : (
        <div className={styles.toolbar}>
          <div className={styles.crumbs} title={currentPath ?? undefined}>
            {crumbs.length ? (
              <>
                {crumbs.map((part, i) => (
                  <span key={`${part}-${i}`} className={styles.crumb}>
                    {i > 0 ? <span className={styles.sep}>›</span> : null}
                    <span
                      className={
                        i === crumbs.length - 1
                          ? missing
                            ? `${styles.file} ${styles.missing}`
                            : styles.file
                          : undefined
                      }
                    >
                      {part}
                    </span>
                  </span>
                ))}
                {dirty ? <span className={styles.dirty}>●</span> : null}
                {missing ? <span className={styles.gone}>{t.deletedBadge}</span> : null}
              </>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {t.noFileOpen}
              </Typography.Text>
            )}
          </div>
          <div className={styles.actions}>
            {isMarkdown && !embedded ? (
              <div className={styles.mdModes} role="group" aria-label={t.mdPreview}>
                <button
                  type="button"
                  className={
                    mdViewMode === "edit"
                      ? `${styles.mdMode} ${styles.active}`
                      : styles.mdMode
                  }
                  onClick={() => setMdViewMode("edit")}
                >
                  {t.mdEdit}
                </button>
                <button
                  type="button"
                  className={
                    mdViewMode === "split"
                      ? `${styles.mdMode} ${styles.active}`
                      : styles.mdMode
                  }
                  onClick={() => setMdViewMode("split")}
                >
                  {t.mdSplit}
                </button>
                <button
                  type="button"
                  className={
                    mdViewMode === "preview"
                      ? `${styles.mdMode} ${styles.active}`
                      : styles.mdMode
                  }
                  onClick={() => setMdViewMode("preview")}
                >
                  {t.mdPreview}
                </button>
              </div>
            ) : null}
            {result?.kind === "text" || result?.kind === "markdown" || missing ? (
              <Button
                size="small"
                type="text"
                disabled={saving || (!dirty && !missing)}
                loading={saving}
                title={t.saveShortcut}
                onClick={() => void save()}
                icon={<SaveOutline size={14} />}
              >
                {missing ? t.saveAsNew : t.save}
              </Button>
            ) : null}
            {embedded ? null : (
              <Button
                size="small"
                type="text"
                onClick={() => void pickFile()}
                icon={<FolderOpenOutline size={14} />}
              >
                {t.openFileEllipsis}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className={styles.viewport}>
        {createPortal(
          floater ? (
            <button
              type="button"
              className={styles.selectionFloater}
              style={{ left: `${selectionFloater.x}px`, top: `${selectionFloater.y}px` }}
              title={t.selectionAddToChat}
              onMouseDown={(event) => {
                event.preventDefault();
                addToChatFromSelection();
              }}
            >
              <ChatbubbleEllipsesOutline size={14} />
              <span>{t.selectionAddToChat}</span>
            </button>
          ) : null,
          document.body,
        )}
        {!currentPath && !isDraft ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.previewHint} />
        ) : (
          <Spin spinning={loading} className={styles.spin}>
            {result ? (
              <>
                {missing || result.kind === "error" ? (
                  <Alert
                    type="error"
                    variant="filled"
                    style={{ margin: "4px 8px" }}
                    title={errorText}
                  />
                ) : result.kind === "unsupported" ? (
                  <Alert
                    type="warning"
                    variant="filled"
                    title={
                      result.reason === "binary" ? t.previewBinary : t.previewUnsupported
                    }
                  />
                ) : null}
                {result.kind === "text" || result.kind === "markdown" ? (
                  <>
                    {result.truncated ? (
                      <Alert
                        type="warning"
                        variant="filled"
                        style={{ margin: "4px 8px" }}
                        title={t.previewTruncated}
                      />
                    ) : null}
                    <div
                      className={
                        isMarkdown && mdViewMode === "split"
                          ? `${styles.docBody} ${styles.mdSplit}`
                          : isMarkdown && mdViewMode === "preview"
                            ? `${styles.docBody} ${styles.mdPreviewOnly}`
                            : styles.docBody
                      }
                    >
                      <div
                        ref={editorHostRef}
                        className={styles.editor}
                        style={{ display: showEditor ? undefined : "none" }}
                      />
                      {showMdPreview ? (
                        <div className={styles.mdPreview}>
                          <MarkdownView content={liveContent} assets={mdAssets} />
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : result.kind === "image" && !missing ? (
                  <div className={styles.mediaWrap}>
                    <img className={styles.img} src={result.dataUrl} alt={result.path} />
                  </div>
                ) : result.kind === "video" && !missing ? (
                  <div className={styles.mediaWrap}>
                    <video
                      ref={videoRef}
                      className={styles.mediaPlayer}
                      controls
                      preload="metadata"
                      src={result.mediaSrc}
                    />
                  </div>
                ) : result.kind === "audio" && !missing ? (
                  <div className={`${styles.mediaWrap} ${styles.audioWrap}`}>
                    <audio
                      ref={audioRef}
                      className={styles.mediaAudio}
                      controls
                      preload="metadata"
                      src={result.mediaSrc}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </Spin>
        )}
      </div>
    </div>
  );
});

export default PreviewTab;
