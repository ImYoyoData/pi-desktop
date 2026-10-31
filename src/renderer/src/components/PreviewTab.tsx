import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, Button, Empty, Spin, Typography } from "antd";
import { fontSizeRem } from "../../../shared/appearance";
import { FolderOpenOutline, SaveOutline } from "@renderer/components/icons/ionicons";
import type { PreviewResult } from "../../../shared/preview-types";
import MarkdownView from "@renderer/components/MarkdownView";
import { ShikiEditor } from "@renderer/components/ShikiEditor";
import { breadcrumbs, languageFromPath } from "@renderer/utils/editor-lang";
import {
  absoluteWorkspacePath,
  isAbsoluteFsPath,
  isInsideWorkspace,
  normalizeFsPath,
  subscribeFsChanges,
} from "@renderer/utils/fs-changed-bus";
import { parentDir } from "@renderer/utils/fs-path";
import type { MarkdownAssetBase } from "@renderer/utils/markdown-assets";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useLayoutStore } from "@renderer/stores/layout";
import { useMediaStore } from "@renderer/stores/media";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./PreviewTab.module.css";

export type MdViewMode = "edit" | "preview" | "split";

type Props = {
  filePath?: string | null;
  tabId?: string;
  active?: boolean;
  /** 智能体设置页内嵌：隐藏「打开文件」等非编辑器控件，markdown 直接以编辑器打开。 */
  embedded?: boolean;
  /** 只隐藏顶部工具栏，不动 markdown 默认视图。 */
  hideToolbar?: boolean;
  /** 未落盘的草稿内容（与 filePath 互斥）。 */
  draftContent?: string | null;
  /** 自定义保存：提供后保存按钮与 Ctrl+S 都交给外部处理（内容由外部落盘）。 */
  saveHandler?: (content: string) => Promise<boolean> | boolean;
  /** 受控的视图模式（文件页标题栏里的编辑/分栏/预览切换）。 */
  viewMode?: MdViewMode;
  onViewModeChange?: (mode: MdViewMode) => void;
};

export type PreviewTabHandle = {
  save: () => Promise<boolean>;
  dirty: boolean;
  getContent: () => string;
  setContent: (content: string) => void;
};

/** 等一帧让 DOM 落地；窗口隐藏时 rAF 不来，超时兑底，绝不能挂死加载。 */
function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(finish, 80);
    requestAnimationFrame(finish);
  });
}

export const PreviewTab = memo(forwardRef<PreviewTabHandle, Props>(function PreviewTab(
  {
    filePath,
    tabId,
    active,
    embedded = false,
    hideToolbar = false,
    draftContent,
    saveHandler,
    viewMode,
    onViewModeChange,
  }: Props,
  ref,
): ReactNode {
  const t = useI18n();
  const message = useMessage();
  const rightCollapsed = useLayoutStore((s) => s.rightCollapsed);

  const [currentPath, setCurrentPath] = useState<string | null>(filePath ?? null);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);
  const [liveContent, setLiveContent] = useState("");
  const [internalViewMode, setInternalViewMode] = useState<MdViewMode>("preview");
  /** 从隐藏变为可见时重建内容区：在 0 尺寸容器里挂载的编辑器不会自己重绘。 */
  const [contentEpoch, setContentEpoch] = useState(0);
  const mdViewMode = viewMode ?? internalViewMode;
  const setMdViewMode = useCallback(
    (mode: MdViewMode): void => {
      if (onViewModeChange) onViewModeChange(mode);
      else setInternalViewMode(mode);
    },
    [onViewModeChange],
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadGenRef = useRef(0);
  const diskContentRef = useRef<string | null>(null);
  const fsGenRef = useRef(0);
  const watchedExternalPathRef = useRef<string | null>(null);
  const stopPreviewWatchRef = useRef<(() => void) | null>(null);
  const unregisterVideoRef = useRef<(() => void) | undefined>(undefined);
  const unregisterAudioRef = useRef<(() => void) | undefined>(undefined);
  const saveShortcutHeldRef = useRef(false);
  const wasActiveRef = useRef(active);
  const activeRef = useRef(active);
  const embeddedRef = useRef(embedded);
  const currentPathRef = useRef(currentPath);
  const resultRef = useRef(result);
  const liveContentRef = useRef(liveContent);
  const missingRef = useRef(missing);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);
  const saveHandlerRef = useRef(saveHandler);
  activeRef.current = active;
  embeddedRef.current = embedded;
  currentPathRef.current = currentPath;
  resultRef.current = result;
  liveContentRef.current = liveContent;
  missingRef.current = missing;
  dirtyRef.current = dirty;
  savingRef.current = saving;
  saveHandlerRef.current = saveHandler;

  const isMarkdown = result?.kind === "markdown";
  const isDraft = !filePath && draftContent != null;
  const showEditor =
    (result?.kind === "text" || result?.kind === "markdown") &&
    (!isMarkdown || mdViewMode !== "preview");
  const showMdPreview = isMarkdown && mdViewMode !== "edit";
  const mediaVisible = Boolean(active) && !rightCollapsed;
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

  async function ensureEditor(content: string, _language: string): Promise<void> {
    await nextFrame();
    setLiveContent(content);
    diskContentRef.current = content;
    setDirty(false);
    setMissing(false);
    syncTabMeta({ dirty: false, missing: false });
  }

  function onEditorChange(next: string): void {
    setLiveContent(next);
    setDirty(true);
    syncTabMeta({ dirty: true });
  }

  async function refreshGitForFile(path: string): Promise<void> {
    try {
      const status = await window.api.git.status({ stats: false });
      if (currentPathRef.current !== path) return;
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
    const switched = currentPathRef.current !== path;
    setCurrentPath(path);
    setDirty(false);
    setMissing(false);
    syncTabMeta({ gitCode: "" });
    diskContentRef.current = null;
    // 换文件时先清空：否则编辑器会拿新语言把上一个文件的内容整篇重新高亮一遍。
    if (switched) {
      setResult(null);
      setLiveContent("");
    }
    if (!path) {
      setResult(null);
      setLiveContent("");
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
          Boolean(liveContentRef.current);
        if (hadCachedDoc) {
          setMissing(true);
          syncTabMeta({ missing: true });
          return;
        }
        setResult(next);
        setLiveContent("");
        setMissing(true);
        syncTabMeta({ missing: true, dirty: false });
        return;
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
        setLiveContent("");
        syncTabMeta({ dirty: false });
      }
      void refreshGitForFile(path);
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      setResult({
        kind: "error",
        path,
        message: err instanceof Error ? err.message : String(err),
      });
      setLiveContent("");
    } finally {
      setLoading(false);
    }
  }

  async function applyDiskContentSilently(path: string, content: string): Promise<void> {
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
    await refreshGitForFile(path);
  }

  /** 内容未落地（窗口隐藏、根目录未就绪、加载被打断）时重新读一次盘。 */
  function reloadIfEmpty(): void {
    const path = currentPathRef.current;
    if (!path || dirtyRef.current) return;
    if (liveContentRef.current) return;
    const current = resultRef.current;
    if (current?.kind === "text" || current?.kind === "markdown") {
      if (!current.content) return;
    } else if (current && current.kind !== "error") {
      return;
    }
    void loadPath(path);
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
      const editorValue = liveContentRef.current;
      if (editorValue === res.content) {
        diskContentRef.current = res.content;
        setDirty(false);
        syncTabMeta({ dirty: false });
        return;
      }
      await applyDiskContentSilently(path, res.content);
    })();
  }

  function onFsChanged(events: { path: string; kind: string }[], root: string): void {
    const path = currentPathRef.current;
    if (!path) return;
    const target = normalizeFsPath(absoluteWorkspacePath(root, path));
    const hit = events.some(
      (event) => normalizeFsPath(absoluteWorkspacePath(root, event.path)) === target,
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
        liveContentRef.current ||
        (current?.kind === "text" || current?.kind === "markdown" ? current.content : "");
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
      liveContentRef.current ||
      (current?.kind === "text" || current?.kind === "markdown" ? current.content : "");
    if (content === "" && !wasMissing) return false;

    setSaving(true);
    try {
      await window.api.preview.write(path, content);
      if (wasMissing) {
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
    return liveContent ?? "";
  }

  function setContent(content: string): void {
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
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (active && !wasActive) setContentEpoch((current) => current + 1);
  }, [active]);

  useEffect(() => {
    if (active && currentPathRef.current) {
      reloadIfEmpty();
      void refreshGitForFile(currentPathRef.current);
    } else {
      stopMedia();
    }
  }, [active]);

  /** 窗口重新可见后补一次：启动/隐藏期间 rAF 与 IPC 可能没把内容送进编辑器。 */
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === "visible") reloadIfEmpty();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /** 工作区（主进程侧 root 同步）就绪后才读盘时会先失败，就绪后补读。 */
  useEffect(() => {
    if (!workspaceRoot) return;
    reloadIfEmpty();
  }, [workspaceRoot]);

  useEffect(() => {
    if (useLayoutStore.getState().rightCollapsed) stopMedia();
  }, [rightCollapsed]);

  useEffect(() => {
    if (!mediaVisible) stopMedia();
  }, [mediaVisible]);

  useEffect(() => {
    syncMediaRegistration();
  }, [result?.kind, tabId]);

  useEffect(() => {
    syncExternalFileWatch();
  }, [currentPath]);

  useEffect(() => {
    if (!tabId) return;
    useRightTabsStore.getState().registerSaveHandler(tabId, save);
    const stopFs = subscribeFsChanges(onFsChanged);
    stopPreviewWatchRef.current = window.api.preview.onChanged(onExternalWatchChanged);
    window.addEventListener("keydown", onPreviewKeydown, true);
    window.addEventListener("keyup", onPreviewKeyup, true);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      if (tabId) useRightTabsStore.getState().unregisterSaveHandler(tabId);
      stopFs();
      stopPreviewWatchRef.current?.();
      stopPreviewWatchRef.current = null;
      if (watchedExternalPathRef.current) {
        void window.api.preview.unwatch(watchedExternalPathRef.current);
        watchedExternalPathRef.current = null;
      }
      window.removeEventListener("keydown", onPreviewKeydown, true);
      window.removeEventListener("keyup", onPreviewKeyup, true);
      window.removeEventListener("blur", onWindowBlur);
      stopMedia();
      unregisterVideoRef.current?.();
      unregisterAudioRef.current?.();
      unregisterVideoRef.current = undefined;
      unregisterAudioRef.current = undefined;
    };
  }, [tabId]);

  return (
    <div className={styles.previewTab}>
      {hideToolbar || embedded ? null : (
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
              <Typography.Text type="secondary" style={{ fontSize: fontSizeRem(11) }}>
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
                      key={contentEpoch}
                      className={
                        isMarkdown && mdViewMode === "split"
                          ? `${styles.docBody} ${styles.mdSplit}`
                          : isMarkdown && mdViewMode === "preview"
                            ? `${styles.docBody} ${styles.mdPreviewOnly}`
                            : styles.docBody
                      }
                    >
                      {showEditor ? (
                        <ShikiEditor
                          className={styles.editor}
                          name={currentPath ?? "untitled"}
                          value={liveContent}
                          language={
                            currentPath ? languageFromPath(currentPath) : "markdown"
                          }
                          onChange={onEditorChange}
                        />
                      ) : null}
                      {showMdPreview ? (
                        <div className={styles.mdPreview}>
                          <MarkdownView
                            content={liveContent}
                            assets={mdAssets}
                            maxChars={2_000_000}
                            htmlImages
                          />
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
}));

export default PreviewTab;
