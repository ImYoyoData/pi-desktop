import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Input } from "antd";
import {
  ArrowBackOutline,
  ArrowForwardOutline,
  CodeSlashOutline,
  ContractOutline,
  ExpandOutline,
  LibraryOutline,
  OpenOutline,
  RefreshOutline,
  Star,
  StarOutline,
} from "@renderer/components/icons/ionicons";
import PenNibIcon from "@renderer/components/icons/PenNibIcon";
import * as prefs from "@renderer/utils/prefs";
import type { ElementCitation } from "../../../shared/protocol";
import { isRegionCitation } from "../../../shared/protocol";
import { useComposerStore } from "@renderer/stores/composer";
import {
  isBookmarked,
  listBookmarks,
  listHistory,
  recordHistory,
  removeBookmark,
  removeHistory,
  toggleBookmark,
  type BookmarkEntry,
  type BrowserLibraryEntry,
} from "@renderer/stores/browser-library";
import BrowserLibraryPanel from "@renderer/components/BrowserLibraryPanel";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { truncateTabLabel } from "../../../shared/tab-label";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./BrowserTab.module.css";

const DEFAULT_URL = "about:blank";
const DEVTOOLS_WIDTH_KEY = "browser:devtoolsWidth";

const WEBVIEW_PREFERENCES = {
  webpreferences: "contextIsolation=yes, nodeIntegration=no",
};

type Props = {
  tabId: string;
  visible?: boolean;
  /** Restored address-bar URL after app restart / workspace switch. */
  initialUrl?: string | null;
};

export function BrowserTab({ tabId, visible, initialUrl }: Props): ReactNode {
  const t = useI18n();
  const composer = useComposerStore();
  const message = useMessage();
  const browserNav = useBrowserNavStore();
  const workspace = useWorkspaceStore();

  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const devtoolsRef = useRef<Electron.WebviewTag | null>(null);
  const splitElRef = useRef<HTMLDivElement | null>(null);
  const ghostElRef = useRef<HTMLDivElement | null>(null);
  const browserRootRef = useRef<HTMLDivElement | null>(null);
  const [devtoolsMountKey, setDevtoolsMountKey] = useState(0);
  const [urlInput, setUrlInput] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [devtoolsReady, setDevtoolsReady] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryTab, setLibraryTab] = useState<"history" | "bookmarks">("history");
  const [historyRows, setHistoryRows] = useState<BrowserLibraryEntry[]>([]);
  const [bookmarkRows, setBookmarkRows] = useState<BookmarkEntry[]>([]);
  const [devtoolsPercent, setDevtoolsPercent] = useState(40);
  const [isDraggingDevtools, setIsDraggingDevtools] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const tabIdRef = useRef(tabId);
  const visibleRef = useRef(visible);
  const selectModeRef = useRef(selectMode);
  const libraryOpenRef = useRef(libraryOpen);
  const libraryTabRef = useRef(libraryTab);
  const devtoolsOpenRef = useRef(devtoolsOpen);
  const awaitingScreenshotIpcRef = useRef(false);
  const draggingRef = useRef(false);
  const rafDragRef = useRef(0);
  const pendingClientXRef = useRef(0);
  tabIdRef.current = tabId;
  visibleRef.current = visible;
  selectModeRef.current = selectMode;
  libraryOpenRef.current = libraryOpen;
  libraryTabRef.current = libraryTab;
  devtoolsOpenRef.current = devtoolsOpen;

  function loadDevtoolsWidth(): void {
    try {
      const raw = prefs.getItem(DEVTOOLS_WIDTH_KEY);
      if (!raw) return;
      const pct = Number(raw);
      if (!Number.isFinite(pct) || pct < 20 || pct > 70) return;
      setDevtoolsPercent(pct);
    } catch {
      // ignore
    }
  }

  function refreshLibrary(): void {
    const root = useWorkspaceStore.getState().root;
    setHistoryRows(listHistory(tabIdRef.current));
    setBookmarkRows(listBookmarks(root));
    setBookmarked(isBookmarked(root, urlInput));
  }

  function normalizeUrl(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return "about:blank";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }

  function guestId(): number | null {
    const wv = webviewRef.current;
    if (!wv) return null;
    try {
      return wv.getWebContentsId();
    } catch {
      return null;
    }
  }

  function devtoolsId(): number | null {
    const wv = devtoolsRef.current;
    if (!wv) return null;
    try {
      return wv.getWebContentsId();
    } catch {
      return null;
    }
  }

  function loadUrlWhenReady(url: string): void {
    const wv = webviewRef.current;
    if (!wv) return;
    const target = normalizeUrl(url);
    try {
      if (wv.getWebContentsId()) {
        void wv.loadURL(target);
        return;
      }
    } catch {
      // not attached yet
    }
    const onDomReady = (): void => {
      void wv.loadURL(target);
      wv.removeEventListener("dom-ready", onDomReady);
    };
    wv.addEventListener("dom-ready", onDomReady);
  }

  function navigate(): void {
    loadUrlWhenReady(normalizeUrl(urlInput));
  }

  function navigateTo(url: string): void {
    setUrlInput(url);
    setLibraryOpen(false);
    navigate();
  }

  function applyPendingNavigate(): void {
    if (visibleRef.current === false) return;
    const url = useBrowserNavStore.getState().takePending(tabIdRef.current);
    if (!url) return;
    navigateTo(url);
  }

  function goBack(): void {
    const wv = webviewRef.current;
    if (wv?.canGoBack()) wv.goBack();
  }

  function goForward(): void {
    const wv = webviewRef.current;
    if (wv?.canGoForward()) wv.goForward();
  }

  function reload(): void {
    webviewRef.current?.reload();
  }

  function onToggleBookmark(): void {
    const url = normalizeUrl(urlInput);
    if (!url || url === "about:blank") {
      message.warning(t.cannotBookmark);
      return;
    }
    const title = pageTitle || webviewRef.current?.getTitle?.() || url;
    const result = toggleBookmark(useWorkspaceStore.getState().root, { url, title });
    setBookmarked(result.bookmarked);
    refreshLibrary();
    message.success(result.bookmarked ? t.bookmarkAdded : t.bookmarkRemoved);
  }

  function toggleLibrary(): void {
    const next = !libraryOpenRef.current;
    setLibraryOpen(next);
    if (next) refreshLibrary();
  }

  function selectLibraryTab(tab: "history" | "bookmarks"): void {
    setLibraryTab(tab);
    refreshLibrary();
  }

  function waitDevtoolsReady(timeoutMs = 3000): Promise<boolean> {
    if (devtoolsReady && devtoolsId() !== null) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = (): void => {
        if (devtoolsReady && devtoolsId() !== null) {
          resolve(true);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        window.setTimeout(tick, 40);
      };
      tick();
    });
  }

  async function remountDevtoolsHost(): Promise<void> {
    setDevtoolsReady(false);
    setDevtoolsMountKey((key) => key + 1);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await waitDevtoolsReady();
  }

  async function toggleDevTools(): Promise<void> {
    const pageId = guestId();
    if (pageId === null) {
      message.warning(t.browserNotReady);
      return;
    }

    const wantOpen = !devtoolsOpen;
    if (wantOpen) {
      if (!devtoolsReady || devtoolsId() === null) {
        await remountDevtoolsHost();
      }
      const dtId = devtoolsId();
      if (dtId === null || !devtoolsReady) {
        message.warning(t.browserNotReady);
        return;
      }
      setDevtoolsOpen(true);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      await new Promise((r) => setTimeout(r, 80));
      const result = await window.api.browser.attachDevTools(pageId, dtId, true);
      if (!result.ok) {
        setDevtoolsOpen(false);
        message.warning(t.cannotOpenDevtools);
      }
      return;
    }

    const dtId = devtoolsId();
    if (dtId !== null) {
      await window.api.browser.attachDevTools(pageId, dtId, false);
    }
    setDevtoolsOpen(false);
    await remountDevtoolsHost();
  }

  async function openExternal(): Promise<void> {
    const url = webviewRef.current?.getURL?.() || urlInput;
    await window.api.browser.openExternal(normalizeUrl(url));
  }

  async function toggleFullscreen(): Promise<void> {
    const el = browserRootRef.current;
    if (!el) {
      setIsFullscreen((value) => !value);
      return;
    }
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen((value) => !value);
    }
  }

  function onFullscreenChange(): void {
    setIsFullscreen(document.fullscreenElement === browserRootRef.current);
  }

  async function applySelectMode(next: boolean): Promise<void> {
    const id = guestId();
    if (id === null) return;
    if (next) {
      const result = await window.api.browser.startSelect(id);
      if (!result.ok) {
        setSelectMode(false);
        message.warning(t.selectNotSupported);
        return;
      }
      setSelectMode(true);
      return;
    }
    setSelectMode(false);
    await window.api.browser.stopSelect(id);
  }

  async function captureWebviewRegion(
    bounds: { x: number; y: number; width: number; height: number },
  ): Promise<string | undefined> {
    const wv = webviewRef.current as (Electron.WebviewTag & {
      capturePage?: (rect?: Electron.Rectangle) => Promise<Electron.NativeImage>;
    }) | null;
    if (!wv || typeof wv.capturePage !== "function") return undefined;
    try {
      const full = await wv.capturePage();
      if (!full || full.isEmpty()) return undefined;
      const fullSize = full.getSize();
      const cssW = Math.max(1, wv.clientWidth || fullSize.width);
      const cssH = Math.max(1, wv.clientHeight || fullSize.height);
      const scaleX = fullSize.width / cssW;
      const scaleY = fullSize.height / cssH;
      const crop = {
        x: Math.max(0, Math.round(bounds.x * scaleX)),
        y: Math.max(0, Math.round(bounds.y * scaleY)),
        width: Math.max(1, Math.round(bounds.width * scaleX)),
        height: Math.max(1, Math.round(bounds.height * scaleY)),
      };
      crop.width = Math.min(crop.width, Math.max(1, fullSize.width - crop.x));
      crop.height = Math.min(crop.height, Math.max(1, fullSize.height - crop.y));

      let image = full;
      try {
        const cropped = full.crop(crop);
        if (!cropped.isEmpty()) image = cropped;
      } catch {
        // keep full page
      }

      const size = image.getSize();
      const maxEdge = 512;
      if (size.width > maxEdge || size.height > maxEdge) {
        const scale = maxEdge / Math.max(size.width, size.height);
        image = image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale)),
        });
      }

      if (typeof image.toDataURL === "function") {
        const url = image.toDataURL();
        if (url?.startsWith("data:")) return url;
      }
      const jpeg = image.toJPEG(85);
      if (jpeg?.length) return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      return undefined;
    } catch (err) {
      console.warn("[browser] webview capture failed", err);
      return undefined;
    }
  }

  async function onCitation(citation: ElementCitation): Promise<void> {
    if (!selectModeRef.current && visibleRef.current === false) return;
    if (!selectModeRef.current && visibleRef.current !== true) return;

    const wasSelecting = selectModeRef.current;
    setSelectMode(false);
    awaitingScreenshotIpcRef.current = false;

    if (wasSelecting) {
      const id = guestId();
      if (id !== null) void window.api.browser.stopSelect(id);
    }

    composer.addCitation(citation);

    let shot = citation.screenshotDataUrl?.startsWith("data:")
      ? citation.screenshotDataUrl
      : undefined;

    if (!shot && citation.bounds && citation.bounds.width > 0 && citation.bounds.height > 0) {
      shot = await captureWebviewRegion(citation.bounds);
    }

    if (shot) {
      composer.addImageFromDataUrl(shot);
      composer.attachScreenshotToLatestElement(shot);
      message.success(isRegionCitation(citation) ? t.regionShotAdded : t.elementTagAndShot);
      return;
    }

    awaitingScreenshotIpcRef.current = true;
    message.success(isRegionCitation(citation) ? t.regionTagAdded : t.elementTagAdded);
    window.setTimeout(() => {
      if (!awaitingScreenshotIpcRef.current) return;
      awaitingScreenshotIpcRef.current = false;
      message.warning(t.elementShotFailed);
    }, 1800);
  }

  function onElementScreenshot(dataUrl: string): void {
    composer.addImageFromDataUrl(dataUrl);
    composer.attachScreenshotToLatestElement(dataUrl);
    if (awaitingScreenshotIpcRef.current) {
      awaitingScreenshotIpcRef.current = false;
      message.success(t.elementShotAdded);
    }
  }

  function rememberNavigation(url: string): void {
    if (!url || url === "about:blank") return;
    setUrlInput(url);
    const title = webviewRef.current?.getTitle?.() || pageTitle || url;
    setPageTitle(title);
    syncTabTitle(title);
    recordHistory(tabIdRef.current, { url, title });
    setBookmarked(isBookmarked(useWorkspaceStore.getState().root, url));
    useRightTabsStore.getState().patchTab(tabIdRef.current, { url });
    reportTabToMain();
    if (libraryOpenRef.current && libraryTabRef.current === "history") refreshLibrary();
  }

  function onDidNavigate(event: Event): void {
    const url = (event as Event & { url?: string }).url;
    if (url) rememberNavigation(url);
  }

  function onPageTitleUpdated(event: Event): void {
    const title = (event as Event & { title?: string }).title;
    if (title) {
      setPageTitle(title);
      syncTabTitle(title);
    }
  }

  function syncTabTitle(raw: string): void {
    const label = truncateTabLabel(raw);
    if (!label) return;
    useRightTabsStore.getState().autoTitleTab(tabIdRef.current, label);
  }

  function onStartLoading(): void {
    setLoading(true);
  }

  function onStopLoading(): void {
    setLoading(false);
    const url = webviewRef.current?.getURL?.();
    if (url) rememberNavigation(url);
  }

  function flushDragGhost(): void {
    rafDragRef.current = 0;
    if (!draggingRef.current || !splitElRef.current || !ghostElRef.current) return;
    const rect = splitElRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fromRight = rect.right - pendingClientXRef.current;
    const minPx = rect.width * 0.2;
    const maxPx = rect.width * 0.7;
    const px = Math.min(maxPx, Math.max(minPx, fromRight));
    ghostElRef.current.style.right = `${px}px`;
    ghostElRef.current.style.display = "block";
  }

  function onDragMove(event: MouseEvent): void {
    if (!draggingRef.current) return;
    pendingClientXRef.current = event.clientX;
    if (!rafDragRef.current) rafDragRef.current = requestAnimationFrame(flushDragGhost);
  }

  function onDragEnd(): void {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDraggingDevtools(false);
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    if (rafDragRef.current) {
      cancelAnimationFrame(rafDragRef.current);
      rafDragRef.current = 0;
    }
    const rect = splitElRef.current?.getBoundingClientRect();
    const ghost = ghostElRef.current;
    if (rect && rect.width > 0 && ghost) {
      const rightPx = Number.parseFloat(ghost.style.right || "0");
      if (Number.isFinite(rightPx) && rightPx > 0) {
        const pct = (rightPx / rect.width) * 100;
        const next = Math.min(70, Math.max(20, pct));
        setDevtoolsPercent(next);
        prefs.setItem(DEVTOOLS_WIDTH_KEY, String(next));
      }
      ghost.style.display = "none";
    }
  }

  function startDevtoolsDrag(event: React.MouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    draggingRef.current = true;
    setIsDraggingDevtools(true);
    pendingClientXRef.current = event.clientX;
    flushDragGhost();
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  }

  function bindWebview(wv: Electron.WebviewTag): void {
    wv.addEventListener("did-navigate", onDidNavigate);
    wv.addEventListener("did-navigate-in-page", onDidNavigate);
    wv.addEventListener("did-start-loading", onStartLoading);
    wv.addEventListener("did-stop-loading", onStopLoading);
    wv.addEventListener("page-title-updated", onPageTitleUpdated);
  }

  function unbindWebview(wv: Electron.WebviewTag): void {
    wv.removeEventListener("did-navigate", onDidNavigate);
    wv.removeEventListener("did-navigate-in-page", onDidNavigate);
    wv.removeEventListener("did-start-loading", onStartLoading);
    wv.removeEventListener("did-stop-loading", onStopLoading);
    wv.removeEventListener("page-title-updated", onPageTitleUpdated);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (visibleRef.current === false) return;
    if (event.key === "F12") {
      event.preventDefault();
      event.stopPropagation();
      void toggleDevTools();
    }
  }

  async function registerPageGuest(): Promise<void> {
    const id = guestId();
    if (id === null) return;
    await window.api.browser.registerGuest(id);
    reportTabToMain();
  }

  function reportTabToMain(): void {
    const id = guestId();
    if (id === null) return;
    void window.api.browser.reportTab({
      tabId: tabIdRef.current,
      webContentsId: id,
      url: urlInput || DEFAULT_URL,
      title: pageTitle,
      visible: visibleRef.current !== false,
      workspaceRoot: useWorkspaceStore.getState().root,
    });
  }

  function onSelectCancelled(): void {
    setSelectMode(false);
    awaitingScreenshotIpcRef.current = false;
  }

  function bindDevtoolsHost(): void {
    const dt = devtoolsRef.current;
    if (!dt) return;
    const markReady = (): void => {
      setDevtoolsReady(true);
      dt.removeEventListener("dom-ready", markReady);
    };
    dt.addEventListener("dom-ready", markReady);
    try {
      if (dt.getWebContentsId()) markReady();
    } catch {
      // wait for dom-ready
    }
  }

  useEffect(() => {
    loadDevtoolsWidth();
    refreshLibrary();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    const offElementSelected = window.api.browser.onElementSelected(onCitation);
    const offElementScreenshot = window.api.browser.onElementScreenshot(onElementScreenshot);
    const offSelectCancelled = window.api.browser.onSelectCancelled(onSelectCancelled);
    const offToggleHotkey = window.api.browser.onToggleEmbeddedDevTools(() => {
      if (visibleRef.current === false) return;
      void toggleDevTools();
    });
    window.addEventListener("keydown", onKeydown, true);
    const wv = webviewRef.current;
    if (wv) {
      bindWebview(wv);
      wv.addEventListener("dom-ready", () => {
        void registerPageGuest();
      });
      try {
        if (wv.getWebContentsId()) void registerPageGuest();
      } catch {
        // wait for dom-ready
      }
    }
    bindDevtoolsHost();
    applyPendingNavigate();
    const restored = (initialUrl || "").trim();
    if (
      restored &&
      restored !== "about:blank" &&
      (!(urlInput || "").trim() || urlInput === "about:blank")
    ) {
      setUrlInput(restored);
      loadUrlWhenReady(restored);
    }
    return () => {
      void window.api.browser.unreportTab(tabIdRef.current);
      offElementSelected();
      offElementScreenshot();
      offSelectCancelled();
      offToggleHotkey();
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeydown, true);
      document.removeEventListener("mousemove", onDragMove);
      document.removeEventListener("mouseup", onDragEnd);
      const id = guestId();
      if (id !== null) {
        void window.api.browser.stopSelect(id);
        if (devtoolsOpenRef.current) {
          const dtId = devtoolsId();
          if (dtId !== null) void window.api.browser.attachDevTools(id, dtId, false);
        }
      }
      const bound = webviewRef.current;
      if (bound) unbindWebview(bound);
    };
  }, []);

  useEffect(() => {
    applyPendingNavigate();
  }, [browserNav.seq, visible, tabId]);

  const workspaceRootRef = useRef(workspace.root);

  useEffect(() => {
    if (workspaceRootRef.current === workspace.root) return;
    workspaceRootRef.current = workspace.root;
    refreshLibrary();
  }, [tabId, workspace.root]);

  useEffect(() => {
    reportTabToMain();
  }, [visible, tabId, urlInput, pageTitle, workspace.root]);

  useEffect(() => {
    bindDevtoolsHost();
  }, [devtoolsMountKey]);

  useEffect(() => {
    if (visible) return;
    if (!selectModeRef.current) return;
    setSelectMode(false);
    const id = guestId();
    if (id !== null) void window.api.browser.stopSelect(id);
  }, [visible]);

  const pageStyle = { width: devtoolsOpen ? `${100 - devtoolsPercent}%` : "100%" };
  const devtoolsStyle = { width: `${devtoolsPercent}%` };

  // 外部浏览器预览模式没有 Electron 的 webview 标签，内置浏览器无法渲染。
  if (window.__piBrowserPreview) {
    return (
      <div className={styles.browserTab} style={{ padding: 24 }}>
        {t.browserPreviewUnavailable}
      </div>
    );
  }

  return (
    <div
      ref={browserRootRef}
      className={
        isFullscreen
          ? `browser-tab ${styles.browserTab} ${styles.isFullscreen}`
          : `browser-tab ${styles.browserTab}`
      }
    >
      <div className={styles.toolbar}>
        <div className={styles.toolbarNav}>
          <Button
            type="text"
            shape="circle"
            size="small"
            onClick={goBack}
            icon={<ArrowBackOutline />}
          />
          <Button
            type="text"
            shape="circle"
            size="small"
            onClick={goForward}
            icon={<ArrowForwardOutline />}
          />
          <Button
            type="text"
            shape="circle"
            size="small"
            loading={loading}
            onClick={reload}
            icon={<RefreshOutline />}
          />
        </div>

        <Input
          size="small"
          className={styles.url}
          value={urlInput}
          placeholder={t.urlPlaceholder}
          onChange={(event) => setUrlInput(event.target.value)}
          onPressEnter={navigate}
        />

        <div className={styles.toolbarActions}>
          <Button
            type="text"
            shape="circle"
            size="small"
            color={bookmarked ? "gold" : undefined}
            onClick={onToggleBookmark}
            icon={bookmarked ? <Star /> : <StarOutline />}
          />

          <Button
            size="small"
            type={selectMode ? "primary" : "default"}
            variant={selectMode ? "filled" : "outlined"}
            className={styles.selectElBtn}
            aria-label={t.selectElement}
            onClick={() => void applySelectMode(!selectMode)}
            icon={<PenNibIcon size={15} />}
          />

          <Button
            type="text"
            shape="circle"
            size="small"
            color={libraryOpen ? "primary" : undefined}
            onClick={toggleLibrary}
            icon={<LibraryOutline />}
          />

          <Button
            type="text"
            shape="circle"
            size="small"
            color={devtoolsOpen ? "primary" : undefined}
            onClick={() => void toggleDevTools()}
            icon={<CodeSlashOutline />}
          />

          <Button
            type="text"
            shape="circle"
            size="small"
            onClick={() => void toggleFullscreen()}
            icon={isFullscreen ? <ContractOutline /> : <ExpandOutline />}
          />

          <Button
            type="text"
            shape="circle"
            size="small"
            onClick={() => void openExternal()}
            icon={<OpenOutline />}
          />
        </div>
      </div>

      <div
        ref={splitElRef}
        className={
          isDraggingDevtools
            ? `${styles.viewportArea} ${styles.isDragging}`
            : styles.viewportArea
        }
      >
        <div className={styles.pagePane} style={pageStyle}>
          <webview
            ref={webviewRef}
            className={styles.viewport}
            src={DEFAULT_URL}
            allowpopups
            {...WEBVIEW_PREFERENCES}
            style={{ display: visible === false ? "none" : undefined }}
          />
          <div
            className={`${styles.viewport} ${styles.placeholder}`}
            style={{ display: visible === false ? undefined : "none" }}
          />
        </div>

        <div
          className={styles.devtoolsHandle}
          title={t.resizeDevtools}
          style={{ display: devtoolsOpen ? undefined : "none" }}
          onMouseDown={startDevtoolsDrag}
        />

        <div
          className={
            devtoolsOpen
              ? styles.devtoolsPane
              : `${styles.devtoolsPane} ${styles.closed}`
          }
          style={devtoolsOpen ? devtoolsStyle : undefined}
        >
          <webview
            key={devtoolsMountKey}
            ref={devtoolsRef}
            className={styles.viewport}
            src="about:blank"
            {...WEBVIEW_PREFERENCES}
          />
        </div>

        <div ref={ghostElRef} className={styles.devtoolsGhost} />

        {libraryOpen ? (
          <aside className={styles.libraryDrawer}>
            <div className={styles.drawerHead}>
              <button
                type="button"
                className={
                  libraryTab === "history"
                    ? `${styles.tab} ${styles.active}`
                    : styles.tab
                }
                onClick={() => selectLibraryTab("history")}
              >
                {t.history}
              </button>
              <button
                type="button"
                className={
                  libraryTab === "bookmarks"
                    ? `${styles.tab} ${styles.active}`
                    : styles.tab
                }
                onClick={() => selectLibraryTab("bookmarks")}
              >
                {t.bookmarks}
              </button>
              <button
                type="button"
                className={styles.drawerClose}
                title={t.close}
                onClick={() => setLibraryOpen(false)}
              >
                ×
              </button>
            </div>
            <BrowserLibraryPanel
              mode={libraryTab}
              history={historyRows}
              bookmarks={bookmarkRows}
              onNavigate={navigateTo}
              onRemoveHistory={(id) => {
                removeHistory(tabId, id);
                refreshLibrary();
              }}
              onRemoveBookmark={(id) => {
                removeBookmark(useWorkspaceStore.getState().root, id);
                refreshLibrary();
              }}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export default BrowserTab;
