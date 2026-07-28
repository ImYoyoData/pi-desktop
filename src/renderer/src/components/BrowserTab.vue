<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  NButton,
  NIcon,
  NInput,
  NTooltip,
  useMessage,
} from "naive-ui";
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
} from "@vicons/ionicons5";
import PenNibIcon from "@renderer/components/icons/PenNibIcon.vue";
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
import BrowserLibraryPanel from "@renderer/components/BrowserLibraryPanel.vue";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { truncateTabLabel } from "../../../shared/tab-label";
import { t } from "@renderer/i18n";

const DEFAULT_URL = "about:blank";
const DEVTOOLS_WIDTH_KEY = "browser:devtoolsWidth";

const composer = useComposerStore();
const message = useMessage();
const browserNav = useBrowserNavStore();
const rightTabs = useRightTabsStore();
const workspace = useWorkspaceStore();

const props = defineProps<{
  tabId: string;
  visible?: boolean;
  /** Restored address-bar URL after app restart / workspace switch. */
  initialUrl?: string | null;
}>();

const webviewRef = ref<Electron.WebviewTag | null>(null);
const devtoolsRef = ref<Electron.WebviewTag | null>(null);
/** Remount DevTools host after close — setDevToolsWebContents requires a unused WebContents. */
const devtoolsMountKey = ref(0);
const splitEl = ref<HTMLElement | null>(null);
const ghostEl = ref<HTMLElement | null>(null);
const urlInput = ref("");
const pageTitle = ref("");
const selectMode = ref(false);
const loading = ref(false);
const devtoolsOpen = ref(false);
const devtoolsReady = ref(false);
const bookmarked = ref(false);
const libraryOpen = ref(false);
const libraryTab = ref<"history" | "bookmarks">("history");
const historyRows = ref<BrowserLibraryEntry[]>([]);
const bookmarkRows = ref<BookmarkEntry[]>([]);
/** DevTools width as % of the browser viewport when open. */
const devtoolsPercent = ref(40);
const isDraggingDevtools = ref(false);
const isFullscreen = ref(false);
const browserRootRef = ref<HTMLElement | null>(null);
let offElementSelected: (() => void) | null = null;
let offElementScreenshot: (() => void) | null = null;
let offSelectCancelled: (() => void) | null = null;
let offToggleHotkey: (() => void) | null = null;
/** True while this tab expects a late screenshot IPC after local capture failed. */
let awaitingScreenshotIpc = false;
let dragging = false;
let rafDrag = 0;
let pendingClientX = 0;

const pageStyle = computed(() =>
  devtoolsOpen.value ? { width: `${100 - devtoolsPercent.value}%` } : { width: "100%" },
);

const devtoolsStyle = computed(() => ({
  width: `${devtoolsPercent.value}%`,
}));

function loadDevtoolsWidth(): void {
  try {
    const raw = localStorage.getItem(DEVTOOLS_WIDTH_KEY);
    if (!raw) return;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < 20 || pct > 70) return;
    devtoolsPercent.value = pct;
  } catch {
    // ignore
  }
}

function refreshLibrary(): void {
  historyRows.value = listHistory(props.tabId);
  bookmarkRows.value = listBookmarks(workspace.root);
  bookmarked.value = isBookmarked(workspace.root, urlInput.value);
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "about:blank";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function guestId(): number | null {
  const wv = webviewRef.value;
  if (!wv) return null;
  try {
    return wv.getWebContentsId();
  } catch {
    return null;
  }
}

function devtoolsId(): number | null {
  const wv = devtoolsRef.value;
  if (!wv) return null;
  try {
    return wv.getWebContentsId();
  } catch {
    return null;
  }
}

function navigate(): void {
  loadUrlWhenReady(normalizeUrl(urlInput.value));
}

function navigateTo(url: string): void {
  urlInput.value = url;
  libraryOpen.value = false;
  navigate();
}

/** loadURL before the guest is attached throws; wait for dom-ready. */
function loadUrlWhenReady(url: string): void {
  const wv = webviewRef.value;
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
  wv.addEventListener(
    "dom-ready",
    () => {
      void wv.loadURL(target);
    },
    { once: true },
  );
}

function applyPendingNavigate(): void {
  if (props.visible === false) return;
  const url = browserNav.takePending(props.tabId);
  if (!url) return;
  navigateTo(url);
}

function goBack(): void {
  const wv = webviewRef.value;
  if (wv?.canGoBack()) wv.goBack();
}

function goForward(): void {
  const wv = webviewRef.value;
  if (wv?.canGoForward()) wv.goForward();
}

function reload(): void {
  webviewRef.value?.reload();
}

function onToggleBookmark(): void {
  const url = normalizeUrl(urlInput.value);
  if (!url || url === "about:blank") {
    message.warning(t.cannotBookmark);
    return;
  }
  const title = pageTitle.value || webviewRef.value?.getTitle?.() || url;
  const result = toggleBookmark(workspace.root, { url, title });
  bookmarked.value = result.bookmarked;
  refreshLibrary();
  message.success(result.bookmarked ? t.bookmarkAdded : t.bookmarkRemoved);
}

function toggleLibrary(): void {
  libraryOpen.value = !libraryOpen.value;
  if (libraryOpen.value) refreshLibrary();
}

function setLibraryTab(tab: "history" | "bookmarks"): void {
  libraryTab.value = tab;
  refreshLibrary();
}

function waitDevtoolsReady(timeoutMs = 3000): Promise<boolean> {
  if (devtoolsReady.value && devtoolsId() !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      if (devtoolsReady.value && devtoolsId() !== null) {
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
  devtoolsReady.value = false;
  devtoolsMountKey.value += 1;
  await nextTick();
  await waitDevtoolsReady();
}

async function toggleDevTools(): Promise<void> {
  const pageId = guestId();
  if (pageId === null) {
    message.warning(t.browserNotReady);
    return;
  }

  const wantOpen = !devtoolsOpen.value;
  if (wantOpen) {
    // Layout pane first so DevTools webview has real size before attach
    if (!devtoolsReady.value || devtoolsId() === null) {
      await remountDevtoolsHost();
    }
    const dtId = devtoolsId();
    if (dtId === null || !devtoolsReady.value) {
      message.warning(t.browserNotReady);
      return;
    }
    devtoolsOpen.value = true;
    await nextTick();
    await new Promise((r) => setTimeout(r, 80));
    const result = await window.api.browser.attachDevTools(pageId, dtId, true);
    if (!result.ok) {
      devtoolsOpen.value = false;
      message.warning(t.cannotOpenDevtools);
    }
    return;
  }

  const dtId = devtoolsId();
  if (dtId !== null) {
    await window.api.browser.attachDevTools(pageId, dtId, false);
  }
  devtoolsOpen.value = false;
  // Fresh host for next open (cannot reuse a WebContents that already showed DevTools)
  await remountDevtoolsHost();
}

async function openExternal(): Promise<void> {
  const url = webviewRef.value?.getURL?.() || urlInput.value;
  await window.api.browser.openExternal(normalizeUrl(url));
}

async function toggleFullscreen(): Promise<void> {
  const el = browserRootRef.value;
  if (!el) {
    isFullscreen.value = !isFullscreen.value;
    return;
  }
  try {
    if (!document.fullscreenElement) {
      await el.requestFullscreen();
      isFullscreen.value = true;
    } else {
      await document.exitFullscreen();
      isFullscreen.value = false;
    }
  } catch {
    isFullscreen.value = !isFullscreen.value;
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = document.fullscreenElement === browserRootRef.value;
}

async function setSelectMode(next: boolean): Promise<void> {
  const id = guestId();
  if (id === null) return;
  if (next) {
    const result = await window.api.browser.startSelect(id);
    if (!result.ok) {
      selectMode.value = false;
      message.warning(t.selectNotSupported);
      return;
    }
    selectMode.value = true;
    return;
  }
  selectMode.value = false;
  await window.api.browser.stopSelect(id);
}

async function captureWebviewRegion(
  bounds: { x: number; y: number; width: number; height: number },
): Promise<string | undefined> {
  const wv = webviewRef.value as (Electron.WebviewTag & {
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
  // Prefer the tab that started select mode; fall back to the visible tab.
  if (!selectMode.value && props.visible === false) return;
  if (!selectMode.value && props.visible !== true) return;

  const wasSelecting = selectMode.value;
  selectMode.value = false;
  awaitingScreenshotIpc = false;

  if (wasSelecting) {
    const id = guestId();
    if (id !== null) void window.api.browser.stopSelect(id);
  } else {
    // Another tab may own select mode — still accept citation once for the visible tab.
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

  awaitingScreenshotIpc = true;
  message.success(isRegionCitation(citation) ? t.regionTagAdded : t.elementTagAdded);
  window.setTimeout(() => {
    if (!awaitingScreenshotIpc) return;
    awaitingScreenshotIpc = false;
    message.warning(t.elementShotFailed);
  }, 1800);
}

function onElementScreenshot(dataUrl: string): void {
  if (!awaitingScreenshotIpc && !selectMode.value) {
    // If we already attached a local shot, still accept as no-op dedupe in store
  }
  composer.addImageFromDataUrl(dataUrl);
  composer.attachScreenshotToLatestElement(dataUrl);
  if (awaitingScreenshotIpc) {
    awaitingScreenshotIpc = false;
    message.success(t.elementShotAdded);
  }
}

function rememberNavigation(url: string): void {
  if (!url || url === "about:blank") return;
  urlInput.value = url;
  const title = webviewRef.value?.getTitle?.() || pageTitle.value || url;
  pageTitle.value = title;
  syncTabTitle(title);
  recordHistory(props.tabId, { url, title });
  bookmarked.value = isBookmarked(workspace.root, url);
  rightTabs.patchTab(props.tabId, { url });
  reportTabToMain();
  if (libraryOpen.value && libraryTab.value === "history") refreshLibrary();
}

function onDidNavigate(event: Event): void {
  const url = (event as Event & { url?: string }).url;
  if (url) rememberNavigation(url);
}

function onPageTitleUpdated(event: Event): void {
  const title = (event as Event & { title?: string }).title;
  if (title) {
    pageTitle.value = title;
    syncTabTitle(title);
  }
}

function syncTabTitle(raw: string): void {
  const label = truncateTabLabel(raw);
  if (!label) return;
  rightTabs.autoTitleTab(props.tabId, label);
  // Persist best-effort when workspace is open (RightPane/workspace also persist on switch)
}

function onStartLoading(): void {
  loading.value = true;
}

function onStopLoading(): void {
  loading.value = false;
  const url = webviewRef.value?.getURL?.();
  if (url) rememberNavigation(url);
}

function flushDragGhost(): void {
  rafDrag = 0;
  if (!dragging || !splitEl.value || !ghostEl.value) return;
  const rect = splitEl.value.getBoundingClientRect();
  if (rect.width <= 0) return;
  const fromRight = rect.right - pendingClientX;
  const minPx = rect.width * 0.2;
  const maxPx = rect.width * 0.7;
  const px = Math.min(maxPx, Math.max(minPx, fromRight));
  // Direct DOM write — avoid Vue reactive updates while dragging (webview thrash)
  ghostEl.value.style.right = `${px}px`;
  ghostEl.value.style.display = "block";
}

function onDragMove(event: MouseEvent): void {
  if (!dragging) return;
  pendingClientX = event.clientX;
  if (!rafDrag) rafDrag = requestAnimationFrame(flushDragGhost);
}

function onDragEnd(): void {
  if (!dragging) return;
  dragging = false;
  isDraggingDevtools.value = false;
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  if (rafDrag) {
    cancelAnimationFrame(rafDrag);
    rafDrag = 0;
  }
  const rect = splitEl.value?.getBoundingClientRect();
  const ghost = ghostEl.value;
  if (rect && rect.width > 0 && ghost) {
    const rightPx = Number.parseFloat(ghost.style.right || "0");
    if (Number.isFinite(rightPx) && rightPx > 0) {
      const pct = (rightPx / rect.width) * 100;
      devtoolsPercent.value = Math.min(70, Math.max(20, pct));
      localStorage.setItem(DEVTOOLS_WIDTH_KEY, String(devtoolsPercent.value));
    }
    ghost.style.display = "none";
  }
}

function startDevtoolsDrag(event: MouseEvent): void {
  event.preventDefault();
  dragging = true;
  isDraggingDevtools.value = true;
  pendingClientX = event.clientX;
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
  if (props.visible === false) return;
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
    tabId: props.tabId,
    webContentsId: id,
    url: urlInput.value || DEFAULT_URL,
    title: pageTitle.value || "",
    visible: props.visible !== false,
    workspaceRoot: workspace.root,
  });
}

function onSelectCancelled(): void {
  selectMode.value = false;
  awaitingScreenshotIpc = false;
}

onMounted(async () => {
  loadDevtoolsWidth();
  refreshLibrary();
  document.addEventListener("fullscreenchange", onFullscreenChange);
  offElementSelected = window.api.browser.onElementSelected(onCitation);
  offElementScreenshot = window.api.browser.onElementScreenshot(onElementScreenshot);
  offSelectCancelled = window.api.browser.onSelectCancelled(onSelectCancelled);
  offToggleHotkey = window.api.browser.onToggleEmbeddedDevTools(() => {
    if (props.visible === false) return;
    void toggleDevTools();
  });
  window.addEventListener("keydown", onKeydown, true);
  await nextTick();
  const wv = webviewRef.value;
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
  const restored = (props.initialUrl || "").trim();
  if (
    restored &&
    restored !== "about:blank" &&
    (!(urlInput.value || "").trim() || urlInput.value === "about:blank")
  ) {
    urlInput.value = restored;
    loadUrlWhenReady(restored);
  }
});

watch(
  () => [browserNav.seq, props.visible, props.tabId] as const,
  () => {
    applyPendingNavigate();
  },
);

watch(
  () => [props.tabId, workspace.root] as const,
  () => {
    refreshLibrary();
  },
);

watch(
  () => [props.visible, props.tabId, urlInput.value, pageTitle.value, workspace.root] as const,
  () => {
    reportTabToMain();
  },
);

watch(devtoolsMountKey, async () => {
  await nextTick();
  bindDevtoolsHost();
});

function bindDevtoolsHost(): void {
  const dt = devtoolsRef.value;
  if (!dt) return;
  const markReady = () => {
    devtoolsReady.value = true;
  };
  dt.addEventListener("dom-ready", markReady, { once: true });
  try {
    if (dt.getWebContentsId()) markReady();
  } catch {
    // wait for dom-ready
  }
}

onUnmounted(() => {
  void window.api.browser.unreportTab(props.tabId);
  offElementSelected?.();
  offElementScreenshot?.();
  offSelectCancelled?.();
  offToggleHotkey?.();
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  window.removeEventListener("keydown", onKeydown, true);
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragEnd);
  const id = guestId();
  if (id !== null) {
    void window.api.browser.stopSelect(id);
    if (devtoolsOpen.value) {
      const dtId = devtoolsId();
      if (dtId !== null) void window.api.browser.attachDevTools(id, dtId, false);
    }
  }
  const wv = webviewRef.value;
  if (wv) unbindWebview(wv);
});

watch(
  () => props.visible,
  (visible) => {
    if (!visible && selectMode.value) {
      selectMode.value = false;
      const id = guestId();
      if (id !== null) void window.api.browser.stopSelect(id);
    }
  },
);
</script>

<template>
  <div
    ref="browserRootRef"
    class="browser-tab"
    :class="{ 'is-fullscreen': isFullscreen }"
  >
    <div class="toolbar">
      <div class="toolbar-nav">
        <NTooltip>
          <template #trigger>
            <NButton quaternary circle size="tiny" @click="goBack">
              <template #icon>
                <NIcon :component="ArrowBackOutline" />
              </template>
            </NButton>
          </template>
          {{ t.back }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NButton quaternary circle size="tiny" @click="goForward">
              <template #icon>
                <NIcon :component="ArrowForwardOutline" />
              </template>
            </NButton>
          </template>
          {{ t.forward }}
        </NTooltip>
        <NTooltip>
          <template #trigger>
            <NButton quaternary circle size="tiny" :loading="loading" @click="reload">
              <template #icon>
                <NIcon :component="RefreshOutline" />
              </template>
            </NButton>
          </template>
          {{ t.reload }}
        </NTooltip>
      </div>

      <NInput
        v-model:value="urlInput"
        size="tiny"
        class="url"
        :placeholder="t.urlPlaceholder"
        @keydown.enter.prevent="navigate"
      />

      <div class="toolbar-actions">
        <NTooltip>
          <template #trigger>
            <NButton
              quaternary
              circle
              size="tiny"
              :type="bookmarked ? 'warning' : 'default'"
              @click="onToggleBookmark"
            >
              <template #icon>
                <NIcon :component="bookmarked ? Star : StarOutline" />
              </template>
            </NButton>
          </template>
          {{ bookmarked ? t.unbookmark : t.bookmarkPage }}
        </NTooltip>

        <NButton
          size="tiny"
          :type="selectMode ? 'primary' : 'default'"
          secondary
          class="select-el-btn"
          :title="t.selectElement"
          :aria-label="t.selectElement"
          @click="setSelectMode(!selectMode)"
        >
          <template #icon>
            <PenNibIcon :size="15" />
          </template>
        </NButton>

        <NTooltip>
          <template #trigger>
            <NButton
              quaternary
              circle
              size="tiny"
              :type="libraryOpen ? 'primary' : 'default'"
              @click="toggleLibrary"
            >
              <template #icon>
                <NIcon :component="LibraryOutline" />
              </template>
            </NButton>
          </template>
          {{ t.historyAndBookmarks }}
        </NTooltip>

        <NTooltip>
          <template #trigger>
            <NButton
              quaternary
              circle
              size="tiny"
              :type="devtoolsOpen ? 'primary' : 'default'"
              @click="toggleDevTools"
            >
              <template #icon>
                <NIcon :component="CodeSlashOutline" />
              </template>
            </NButton>
          </template>
          {{ t.devtools }}
        </NTooltip>

        <NTooltip>
          <template #trigger>
            <NButton quaternary circle size="tiny" @click="toggleFullscreen">
              <template #icon>
                <NIcon :component="isFullscreen ? ContractOutline : ExpandOutline" />
              </template>
            </NButton>
          </template>
          {{ isFullscreen ? t.browserExitFullscreen : t.browserFullscreen }}
        </NTooltip>

        <NTooltip>
          <template #trigger>
            <NButton quaternary circle size="tiny" @click="openExternal">
              <template #icon>
                <NIcon :component="OpenOutline" />
              </template>
            </NButton>
          </template>
          {{ t.openInSystemBrowser }}
        </NTooltip>
      </div>
    </div>

    <div
      ref="splitEl"
      class="viewport-area"
      :class="{ 'is-dragging': isDraggingDevtools }"
    >
      <div class="page-pane" :style="pageStyle">
        <webview
          v-show="visible !== false"
          ref="webviewRef"
          class="viewport"
          :src="DEFAULT_URL"
          allowpopups
          webpreferences="contextIsolation=yes, nodeIntegration=no"
        />
        <div v-show="visible === false" class="viewport placeholder" />
      </div>

      <div
        v-show="devtoolsOpen"
        class="devtools-handle"
        :title="t.resizeDevtools"
        @mousedown="startDevtoolsDrag"
      />

      <div
        class="devtools-pane"
        :class="{ closed: !devtoolsOpen }"
        :style="devtoolsOpen ? devtoolsStyle : undefined"
      >
        <webview
          :key="devtoolsMountKey"
          ref="devtoolsRef"
          class="viewport"
          src="about:blank"
          webpreferences="contextIsolation=yes, nodeIntegration=no"
        />
      </div>

      <div ref="ghostEl" class="devtools-ghost" />

      <aside v-if="libraryOpen" class="library-drawer">
        <div class="drawer-head">
          <button
            type="button"
            class="tab"
            :class="{ active: libraryTab === 'history' }"
            @click="setLibraryTab('history')"
          >
            {{ t.history }}
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: libraryTab === 'bookmarks' }"
            @click="setLibraryTab('bookmarks')"
          >
            {{ t.bookmarks }}
          </button>
          <button type="button" class="drawer-close" :title="t.close" @click="libraryOpen = false">
            ×
          </button>
        </div>
        <BrowserLibraryPanel
          :mode="libraryTab"
          :history="historyRows"
          :bookmarks="bookmarkRows"
          @navigate="navigateTo"
          @remove-history="
            (id) => {
              removeHistory(props.tabId, id);
              refreshLibrary();
            }
          "
          @remove-bookmark="
            (id) => {
              removeBookmark(workspace.root, id);
              refreshLibrary();
            }
          "
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.browser-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.browser-tab.is-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 10000;
  height: 100vh;
  width: 100vw;
  background: var(--bg);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
  z-index: 2;
  min-width: 0;
}

.toolbar-nav,
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.url {
  flex: 1 1 auto;
  min-width: 12rem;
  width: 0;
}

.select-el-btn :deep(.n-button__icon) {
  margin: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.viewport-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
}

.viewport-area.is-dragging .viewport {
  pointer-events: none;
}

.page-pane,
.devtools-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: #fff;
  flex-shrink: 0;
}

.devtools-pane {
  background: #202124;
}

.devtools-pane.closed {
  position: absolute;
  width: 1px !important;
  height: 1px !important;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

.devtools-handle {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--border);
  position: relative;
  z-index: 1;
}

.devtools-handle:hover,
.devtools-handle:active {
  background: #cfcfcf;
}

.devtools-handle::before {
  content: "";
  position: absolute;
  inset: 0 -3px;
}

.devtools-ghost {
  display: none;
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-right: -1px;
  background: var(--accent);
  z-index: 4;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.25);
}

.viewport {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  display: flex;
}

.placeholder {
  background: var(--bg-panel);
}

.library-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(320px, 85%);
  z-index: 5;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.08);
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 8px 0;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.drawer-head .tab {
  border: none;
  background: transparent;
  padding: 6px 12px;
  font-size: 12.5px;
  color: var(--fg-muted);
  cursor: pointer;
  border-radius: 6px 6px 0 0;
}

.drawer-head .tab.active {
  color: var(--fg-strong);
  font-weight: 600;
  background: var(--bg-hover);
}

.drawer-close {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}

.drawer-close:hover {
  background: var(--bg-hover);
  color: var(--fg-strong);
}

.library-drawer :deep(.library-panel) {
  flex: 1;
  min-height: 0;
}
</style>
