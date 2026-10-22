import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button, Dropdown, Input, Menu, Modal } from "antd";
import type { MenuProps } from "antd";
import Sortable from "sortablejs";
import {
  AddOutline,
  CloseOutline,
  ContractOutline,
  CreateOutline,
  DocumentTextOutline,
  ExpandOutline,
  GitCompareOutline,
  GitPullRequestOutline,
  GlobeOutline,
  ListOutline,
  PlayCircleOutline,
  TerminalOutline,
  TrashOutline,
  ChevronBackOutline,
  ChevronForwardOutline,
} from "@renderer/components/icons/ionicons";
import DiffTab from "@renderer/components/DiffTab";
import BrowserTab from "@renderer/components/BrowserTab";
import RunningTab from "@renderer/components/RunningTab";
import PreviewTab from "@renderer/components/PreviewTab";
import FilesTab from "@renderer/components/FilesTab";
import RightDockChanges from "@renderer/components/RightDockChanges";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useBrowserNavStore } from "@renderer/stores/browser-nav";
import { useLayoutStore } from "@renderer/stores/layout";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { usePreviewStore } from "@renderer/stores/preview";
import { useRightTabsStore, type RightTab, type RightTabKind } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { gitCodeColor } from "@renderer/utils/editor-lang";
import { fileIcon, type FileIcon } from "@renderer/utils/file-icon";
import { localizedTabLabel } from "@renderer/utils/right-tab-labels";
import * as prefs from "@renderer/utils/prefs";
import type {
  ProgramStatusReport,
  ProgramStatusState,
} from "@renderer/utils/osc-program-status";
import { useDialog } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./RightPane.module.css";

const DOCK_VIEW_KEY = "pi-desktop:right-dock-view:v1";
const DOCK_DETAILS_KEY = "pi-desktop:right-dock-details:v1";
const DOCK_WIDTH_KEY = "pi-desktop:right-dock-width:v1";
const DOCK_MIN_WIDTH = 110;
const DOCK_MAX_WIDTH = 480;

type DockView = "files" | "changes" | null;

function readDockView(): DockView {
  try {
    const raw = prefs.getItem(DOCK_VIEW_KEY);
    if (raw === "files" || raw === "changes") return raw;
  } catch {
    // ignore
  }
  return "changes";
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = prefs.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return fallback;
}

function readDockWidth(): number {
  try {
    const n = Number(prefs.getItem(DOCK_WIDTH_KEY));
    if (Number.isFinite(n)) return Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, n));
  } catch {
    // ignore
  }
  return 180;
}

export function RightPane(): ReactNode {
  const t = useI18n();
  const layout = useLayoutStore();
  const keybindings = useKeybindingsStore();
  const previewStore = usePreviewStore();
  const rightTabs = useRightTabsStore();
  const workspace = useWorkspaceStore();
  const agentRuns = useAgentRunsStore();
  const dialog = useDialog();

  const [dockView, setDockView] = useState<DockView>(readDockView);
  const [detailsVisible, setDetailsVisible] = useState(() =>
    readFlag(DOCK_DETAILS_KEY, true),
  );
  const [dockWidth, setDockWidth] = useState(readDockWidth);
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false);
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [deletedPrompt, setDeletedPrompt] = useState<{ id: string } | null>(null);
  const [ctxMenu, setCtxMenu] = useState({
    show: false,
    x: 0,
    y: 0,
    tabId: null as string | null,
  });

  const tabsBarRef = useRef<HTMLDivElement | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const tabsSortableRef = useRef<Sortable | null>(null);
  const tabsResizeObsRef = useRef<ResizeObserver | null>(null);
  const openSignalRef = useRef(previewStore.openSignal);

  const active = rightTabs.activeTab;
  const runningCount = agentRuns.runs.length;
  const dockIdsKey = rightTabs.dockTabs.map((tab) => tab.id).join("|");

  function tabLabelStyle(tab: RightTab): React.CSSProperties | undefined {
    if (tab.missing) {
      return {
        color: gitCodeColor("D"),
        textDecoration: "line-through",
      };
    }
    if (tab.gitCode) return { color: gitCodeColor(tab.gitCode) };
    if (tab.dirty) return { color: gitCodeColor("M") };
    return undefined;
  }

  const tabIcons = useMemo(() => {
    const icons = new Map<string, FileIcon>();
    for (const tab of rightTabs.dockTabs) {
      if (tab.kind !== "preview" || !tab.filePath) continue;
      const icon = fileIcon(tab.filePath);
      let statusColor: string | undefined;
      if (tab.missing) statusColor = gitCodeColor("D");
      else if (tab.gitCode) statusColor = gitCodeColor(tab.gitCode);
      else if (tab.dirty) statusColor = gitCodeColor("M");
      icons.set(tab.id, statusColor ? { ...icon, color: statusColor } : icon);
    }
    return icons;
  }, [rightTabs.dockTabs]);

  function updateTabsScrollState(): void {
    const el = tabsBarRef.current;
    if (!el) {
      setCanScrollTabsLeft(false);
      setCanScrollTabsRight(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    const overflow = max > 2;
    setCanScrollTabsLeft(overflow && el.scrollLeft > 2);
    setCanScrollTabsRight(overflow && el.scrollLeft < max - 2);
  }

  function scrollTabsBy(dir: -1 | 1): void {
    const el = tabsBarRef.current;
    if (!el) return;
    const step = Math.max(120, Math.floor(el.clientWidth * 0.55));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }

  function onTabsWheel(event: React.WheelEvent<HTMLDivElement>): void {
    const el = tabsBarRef.current;
    if (!el || el.scrollWidth <= el.clientWidth + 2) return;
    const dx = event.deltaX;
    const dy = event.deltaY;
    if (Math.abs(dx) > Math.abs(dy) && dx !== 0) {
      el.scrollLeft += dx;
      event.preventDefault();
      updateTabsScrollState();
      return;
    }
    if (dy !== 0) {
      el.scrollLeft += dy;
      event.preventDefault();
      updateTabsScrollState();
    }
  }

  function bindTabsScrollObservers(): void {
    tabsResizeObsRef.current?.disconnect();
    tabsResizeObsRef.current = null;
    const el = tabsBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      updateTabsScrollState();
      return;
    }
    const observer = new ResizeObserver(() => updateTabsScrollState());
    observer.observe(el);
    tabsResizeObsRef.current = observer;
    updateTabsScrollState();
  }

  function destroyTabsSortable(): void {
    tabsSortableRef.current?.destroy();
    tabsSortableRef.current = null;
  }

  function bindTabsSortable(): void {
    destroyTabsSortable();
    const el = tabsBarRef.current;
    if (!el || useRightTabsStore.getState().dockTabs.length < 2) return;
    tabsSortableRef.current = Sortable.create(el, {
      animation: 150,
      direction: "horizontal",
      draggable: `.${styles.tabItem}`,
      filter: `.${styles.tabClose}`,
      preventOnFilter: false,
      delay: 0,
      delayOnTouchOnly: true,
      onEnd: () => {
        const ids = [
          ...el.querySelectorAll<HTMLElement>(`.${styles.tabItem}[data-id]`),
        ]
          .map((n) => n.dataset.id)
          .filter((id): id is string => Boolean(id));
        const store = useRightTabsStore.getState();
        if (ids.length !== store.dockTabs.length) return;
        const same = ids.every((id, i) => store.dockTabs[i]?.id === id);
        if (same) return;
        store.reorderDock(ids);
        store.persistTabs(useWorkspaceStore.getState().root);
        requestAnimationFrame(() => bindTabsSortable());
      },
    });
  }

  function toggleDetails(): void {
    setDetailsVisible((current) => !current);
  }

  function toggleMaximizeEditor(): void {
    useLayoutStore.getState().toggleEditorMaximized();
  }

  function showFilesPanel(): void {
    const layoutState = useLayoutStore.getState();
    if (layoutState.rightCollapsed) layoutState.toggleRightCollapsed();
    setDetailsVisible(true);
    setDockView("files");
  }

  function onLayoutKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
    if (event.code === "KeyE") {
      event.preventDefault();
      toggleMaximizeEditor();
    } else if (event.code === "KeyL") {
      event.preventDefault();
      toggleDetails();
    }
  }

  function onDividerDown(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = dockWidth;
    const onMove = (e: MouseEvent): void => {
      const next = startWidth - (e.clientX - startX);
      setDockWidth(Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, next)));
    };
    const onUp = (): void => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function iconFor(kind: RightTabKind): ReactNode {
    switch (kind) {
      case "running":
        return <PlayCircleOutline />;
      case "changes":
        return <GitCompareOutline />;
      case "files":
        return <DocumentTextOutline />;
      case "browser":
        return <GlobeOutline />;
      case "terminal":
        return <TerminalOutline />;
      case "preview":
        return <DocumentTextOutline />;
      default: {
        const _never: never = kind;
        return _never;
      }
    }
  }

  function tabDisplayLabel(tab: RightTab): string {
    const base = localizedTabLabel(tab);
    if (tab.missing) return base;
    if (tab.dirty) return `${base}*`;
    return base;
  }

  function piStateLabel(state: ProgramStatusState): string {
    switch (state) {
      case "working":
        return t.terminalPiWorking;
      case "blocked":
        return t.terminalPiBlocked;
      case "done":
        return t.terminalPiDone;
      case "error":
        return t.terminalPiError;
      default:
        return t.terminalPiIdle;
    }
  }

  function piStatusTitle(status: ProgramStatusReport): string {
    const label = piStateLabel(status.state);
    return status.message ? `${label} · ${status.message}` : label;
  }

  const addOptions: MenuProps["items"] = [
    { label: t.browser, key: "browser", icon: <GlobeOutline /> },
    { label: t.runningTab, key: "running", icon: <PlayCircleOutline /> },
    { label: t.pullRequests, key: "pull-requests", icon: <GitPullRequestOutline /> },
  ];

  function onAddSelect(key: string): void {
    if (key === "pull-requests") {
      useLayoutStore.getState().showPullRequests();
      return;
    }
    useRightTabsStore.getState().addTab(key as RightTabKind);
  }

  function doClose(id: string): void {
    useRightTabsStore.getState().closeTab(id);
  }

  function onTabClose(id: string): void {
    const tab = useRightTabsStore.getState().tabs.find((item) => item.id === id);
    if (!tab) return;

    if (tab.kind === "preview" && tab.missing) {
      setDeletedPrompt({ id });
      return;
    }

    if (tab.kind === "preview" && tab.dirty && !tab.missing) {
      dialog.create({
        title: t.unsavedChangesTitle,
        content: t.unsavedChangesClose(tab.label),
        positiveText: t.save,
        negativeText: t.dontSave,
        onPositiveClick: async () => {
          const ok = await useRightTabsStore.getState().saveTab(id);
          if (ok) doClose(id);
          return ok;
        },
        onNegativeClick: () => {
          doClose(id);
        },
      });
      return;
    }
    doClose(id);
  }

  function onTabChange(id: string): void {
    useRightTabsStore.getState().selectTab(id);
  }

  function canRenameTab(tab: RightTab): boolean {
    return (
      tab.kind === "browser" ||
      tab.kind === "terminal" ||
      tab.kind === "preview" ||
      tab.kind === "running"
    );
  }

  function tabContextOptions(tab: RightTab): MenuProps["items"] {
    const items: MenuProps["items"] = [];
    if (canRenameTab(tab)) {
      items.push({ label: t.renameTab, key: "rename", icon: <CreateOutline /> });
    }
    if (tab.kind !== "running") {
      items.push({ label: t.deleteTab, key: "delete", icon: <TrashOutline /> });
    }
    return items;
  }

  function openTabContextMenu(event: ReactMouseEvent, tab: RightTab): void {
    if (tab.kind === "files") return;
    const options = tabContextOptions(tab);
    if (!options || !options.length) return;
    setCtxMenu({ show: true, x: event.clientX, y: event.clientY, tabId: tab.id });
  }

  function closeTabContextMenu(): void {
    setCtxMenu((current) => ({ ...current, show: false, tabId: null }));
  }

  function onTabContextSelect(key: string): void {
    const tab = useRightTabsStore
      .getState()
      .tabs.find((item) => item.id === ctxMenu.tabId);
    closeTabContextMenu();
    if (!tab) return;
    if (key === "rename") {
      if (!canRenameTab(tab)) return;
      setRenameTargetId(tab.id);
      setRenameDraft(tab.label);
      setRenameVisible(true);
      return;
    }
    if (key === "delete") onTabClose(tab.id);
  }

  function submitRenameTab(): void {
    const id = renameTargetId;
    const name = renameDraft.trim();
    if (!id || !name) {
      setRenameVisible(false);
      return;
    }
    const store = useRightTabsStore.getState();
    store.renameTab(id, name);
    store.persistTabs(useWorkspaceStore.getState().root);
    setRenameVisible(false);
    setRenameTargetId(null);
  }

  useEffect(() => {
    if (!dockView) return;
    try {
      prefs.setItem(DOCK_VIEW_KEY, dockView);
    } catch {
      // ignore
    }
  }, [dockView]);

  useEffect(() => {
    try {
      prefs.setItem(DOCK_DETAILS_KEY, detailsVisible ? "1" : "0");
    } catch {
      // ignore
    }
  }, [detailsVisible]);

  useEffect(() => {
    try {
      prefs.setItem(DOCK_WIDTH_KEY, String(dockWidth));
    } catch {
      // ignore
    }
  }, [dockWidth]);

  useEffect(() => {
    if (openSignalRef.current === previewStore.openSignal) return;
    openSignalRef.current = previewStore.openSignal;
    const path = usePreviewStore.getState().filePath;
    if (!path) return;
    const store = useRightTabsStore.getState();
    store.addTab("preview", {
      filePath: path,
      label: path.split(/[/\\]/).pop() ?? t.preview,
    });
    void store.refreshPreviewGitMeta();
    const layoutState = useLayoutStore.getState();
    if (layoutState.rightCollapsed) layoutState.toggleRightCollapsed();
  }, [previewStore.openSignal]);

  useEffect(() => {
    const tabs = useRightTabsStore.getState().tabs;
    for (const tab of [...tabs]) {
      if (tab.kind === "files") useRightTabsStore.getState().closeTab(tab.id);
    }
    for (const tab of [...useRightTabsStore.getState().tabs]) {
      if (tab.kind === "changes" && !tab.filePath) {
        useRightTabsStore.getState().closeTab(tab.id);
      }
    }
    window.addEventListener("keydown", onLayoutKeydown);
    keybindings.register("right-pane-files", showFilesPanel);
    void useRightTabsStore.getState().refreshPreviewGitMeta();
    requestAnimationFrame(() => {
      bindTabsSortable();
      bindTabsScrollObservers();
    });
    void useAgentRunsStore.getState().refresh(useWorkspaceStore.getState().root);

    const offOpenBrowserTab = window.api.browser.onOpenTab((payload) => {
      try {
        if (useLayoutStore.getState().rightCollapsed) {
          useLayoutStore.setState({ rightCollapsed: false });
        }
        const store = useRightTabsStore.getState();
        const tab = store.addTab("browser");
        const url = (payload.url || "").trim();
        if (url && /^https?:\/\//i.test(url)) {
          store.patchTab(tab.id, { url });
          useBrowserNavStore.getState().requestNavigate(url, tab.id);
        }
        void window.api.browser.openTabAck({ requestId: payload.requestId, tabId: tab.id });
      } catch (err) {
        void window.api.browser.openTabAck({
          requestId: payload.requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    const offCloseBrowserTab = window.api.browser.onCloseTab((payload) => {
      const id = (payload.tabId || "").trim();
      if (!id) return;
      useRightTabsStore.getState().closeTab(id);
    });
    return () => {
      keybindings.unregister("right-pane-files");
      destroyTabsSortable();
      tabsResizeObsRef.current?.disconnect();
      tabsResizeObsRef.current = null;
      offOpenBrowserTab();
      offCloseBrowserTab();
      window.removeEventListener("keydown", onLayoutKeydown);
    };
  }, []);

  const workspaceRootRef = useRef(workspace.root);

  useEffect(() => {
    if (workspaceRootRef.current === workspace.root) return;
    workspaceRootRef.current = workspace.root;
    void useAgentRunsStore.getState().refresh(workspace.root);
  }, [workspace.root]);

  useEffect(() => {
    requestAnimationFrame(() => {
      bindTabsSortable();
      bindTabsScrollObservers();
      const activeEl = tabsBarRef.current?.querySelector<HTMLElement>(
        `.${styles.tabItem}[data-id="${rightTabs.activeId}"]`,
      );
      activeEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
      updateTabsScrollState();
    });
  }, [dockIdsKey]);

  useEffect(() => {
    requestAnimationFrame(() => {
      const activeEl = tabsBarRef.current?.querySelector<HTMLElement>(
        `.${styles.tabItem}[data-id="${rightTabs.activeId}"]`,
      );
      activeEl?.scrollIntoView({ inline: "nearest", block: "nearest" });
      updateTabsScrollState();
    });
  }, [rightTabs.activeId]);

  useEffect(() => {
    if (!ctxMenu.show) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (ctxMenuRef.current?.contains(event.target as Node)) return;
      closeTabContextMenu();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeTabContextMenu();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [ctxMenu.show]);

  const ctxMenuTab = rightTabs.tabs.find((tab) => tab.id === ctxMenu.tabId) ?? null;
  const ctxMenuItems: MenuProps["items"] = ctxMenuTab
    ? tabContextOptions(ctxMenuTab)
    : [];

  return (
    <aside className={`right-pane ${styles.root}`}>
      <header className={styles.head}>
        <div className={styles.tabsRow}>
          <Button
            type="text"
            shape="circle"
            size="small"
            className={`pi-interactive ${styles.tabsScrollBtn}`}
            disabled={!canScrollTabsLeft}
            title={t.tabsScrollLeft}
            onClick={() => scrollTabsBy(-1)}
            icon={<ChevronBackOutline size={14} />}
          />

          <div
            ref={tabsBarRef}
            className={`${styles.tabsBar}${
              canScrollTabsLeft ? ` ${styles.canScrollLeft}` : ""
            }${canScrollTabsRight ? ` ${styles.canScrollRight}` : ""}`}
            onScroll={updateTabsScrollState}
            onWheel={onTabsWheel}
          >
            {rightTabs.dockTabs.map((tab) => {
              const isActive = tab.id === rightTabs.activeId;
              const hasRuns = tab.kind === "running" && runningCount > 0;
              const fileGlyph = tabIcons.get(tab.id);
              const labelStyle = tabLabelStyle(tab);
              const transient =
                tab.kind === "changes" ||
                (tab.kind === "preview" && tab.transient !== false && !tab.dirty);
              return (
                <div
                  key={tab.id}
                  className={`${styles.tabItem}${isActive ? ` ${styles.active}` : ""}${
                    hasRuns ? ` ${styles.hasRuns}` : ""
                  }`}
                  data-id={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onTabChange(tab.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openTabContextMenu(event, tab);
                  }}
                >
                  {fileGlyph ? (
                    <span
                      className={styles.tabFileGlyph}
                      style={fileGlyph.color ? { color: fileGlyph.color } : undefined}
                      aria-hidden="true"
                    >
                      {fileGlyph.glyph}
                    </span>
                  ) : (
                    <span className={styles.tabIcon} style={labelStyle}>
                      {iconFor(tab.kind)}
                    </span>
                  )}
                  <span
                    className={
                      transient
                        ? `${styles.tabLabel} ${styles.transient}`
                        : styles.tabLabel
                    }
                    style={labelStyle}
                  >
                    {tabDisplayLabel(tab)}
                  </span>
                  {tab.kind === "terminal" && tab.piStatus ? (
                    <span
                      className={`${styles.tabPiStatus} ${
                        styles[
                          `is${tab.piStatus.state.charAt(0).toUpperCase()}${tab.piStatus.state.slice(1)}`
                        ] ?? ""
                      }`}
                      title={piStatusTitle(tab.piStatus)}
                      aria-hidden="true"
                    />
                  ) : null}
                  {hasRuns ? (
                    <span className={styles.tabRunCount}>{runningCount}</span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.tabClose}
                    title={t.closeTab}
                    onClick={(event) => {
                      event.stopPropagation();
                      onTabClose(tab.id);
                    }}
                  >
                    <CloseOutline size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          <Button
            type="text"
            shape="circle"
            size="small"
            className={`pi-interactive ${styles.tabsScrollBtn}`}
            disabled={!canScrollTabsRight}
            title={t.tabsScrollRight}
            onClick={() => scrollTabsBy(1)}
            icon={<ChevronForwardOutline size={14} />}
          />

          <Dropdown
            trigger={["click"]}
            menu={{ items: addOptions, onClick: ({ key }) => onAddSelect(key) }}
          >
            <Button
              type="text"
              shape="circle"
              size="small"
              className="pi-interactive"
              title={t.newTab}
              icon={<AddOutline size={14} />}
            />
          </Dropdown>

          <button
            type="button"
            className={`pi-interactive ${styles.layoutBtn}${
              detailsVisible ? ` ${styles.toggled}` : ""
            }`}
            title={t.toggleDetails}
            aria-pressed={detailsVisible}
            onClick={toggleDetails}
          >
            <ListOutline size={14} />
          </button>
          <button
            type="button"
            className={`pi-interactive ${styles.layoutBtn}`}
            title={layout.editorMaximized ? t.restoreEditorArea : t.maximizeEditorArea}
            onClick={toggleMaximizeEditor}
          >
            {layout.editorMaximized ? <ContractOutline size={14} /> : <ExpandOutline size={14} />}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.tabPanels}>
          {rightTabs.dockTabs.map((tab) => {
            const isActive = active?.id === tab.id;
            const panelStyle = isActive ? undefined : { display: "none" };
            if (tab.kind === "running") {
              return (
                <div key={tab.id} className={styles.tabPanel} style={panelStyle}>
                  <RunningTab visible={isActive && !layout.rightCollapsed} />
                </div>
              );
            }
            if (tab.kind === "changes") {
              return (
                <div key={tab.id} className={styles.tabPanel} style={panelStyle}>
                  <DiffTab
                    filePath={tab.filePath ?? null}
                    visible={isActive && !layout.rightCollapsed}
                  />
                </div>
              );
            }
            if (tab.kind === "browser") {
              return (
                <div key={tab.id} className={styles.tabPanel} style={panelStyle}>
                  <BrowserTab
                    tabId={tab.id}
                    initialUrl={tab.url ?? null}
                    visible={isActive && !layout.rightCollapsed}
                  />
                </div>
              );
            }
            if (tab.kind === "preview") {
              return (
                <div key={tab.id} className={styles.tabPanel} style={panelStyle}>
                  <PreviewTab tabId={tab.id} filePath={tab.filePath ?? null} active={isActive} />
                </div>
              );
            }
            return null;
          })}
        </div>

        {detailsVisible ? (
          <div
            className={styles.dockDivider}
            aria-hidden="true"
            onMouseDown={onDividerDown}
          />
        ) : null}
        <div
          className={styles.dockCol}
          style={{ display: detailsVisible ? undefined : "none", width: `${dockWidth}px` }}
        >
          <div className={styles.dockColHead} role="tablist">
            <button
              type="button"
              role="tab"
              className={
                dockView === "files"
                  ? `${styles.dockTab} ${styles.active}`
                  : styles.dockTab
              }
              aria-selected={dockView === "files"}
              onClick={() => setDockView("files")}
            >
              {t.filesTab}
            </button>
            <button
              type="button"
              role="tab"
              className={
                dockView === "changes"
                  ? `${styles.dockTab} ${styles.active}`
                  : styles.dockTab
              }
              aria-selected={dockView === "changes"}
              onClick={() => setDockView("changes")}
            >
              {t.changesTab}
            </button>
          </div>
          <div className={styles.dockColBody}>
            {dockView === "files" ? (
              <FilesTab embedded />
            ) : (
              <RightDockChanges visible={!layout.rightCollapsed && detailsVisible} />
            )}
          </div>
        </div>
      </div>

      {ctxMenu.show
        ? createPortal(
            <div
              ref={ctxMenuRef}
              className={styles.ctxMenu}
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onContextMenu={(event) => event.preventDefault()}
            >
              <Menu
                mode="vertical"
                items={ctxMenuItems}
                onClick={({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  onTabContextSelect(key);
                }}
              />
            </div>,
            document.body,
          )
        : null}

      <Modal
        open={renameVisible}
        title={t.renameTab}
        width={360}
        maskClosable
        okText={t.confirm}
        cancelText={t.cancel}
        onOk={submitRenameTab}
        onCancel={() => setRenameVisible(false)}
      >
        <p className={styles.renameHint}>{t.renameTabPrompt}</p>
        <Input
          value={renameDraft}
          placeholder={t.renameTabPlaceholder}
          onChange={(event) => setRenameDraft(event.target.value)}
          onPressEnter={submitRenameTab}
        />
      </Modal>

      <Modal
        open={deletedPrompt !== null}
        title={t.fileDeletedTitle}
        onCancel={() => setDeletedPrompt(null)}
        footer={[
          <Button key="cancel" size="small" onClick={() => setDeletedPrompt(null)}>
            {t.cancel}
          </Button>,
          <Button
            key="dont-save"
            size="small"
            onClick={() => {
              const id = deletedPrompt?.id;
              setDeletedPrompt(null);
              if (id) doClose(id);
            }}
          >
            {t.dontSave}
          </Button>,
          <Button
            key="save"
            size="small"
            type="primary"
            onClick={() => {
              const id = deletedPrompt?.id;
              if (!id) return;
              void (async () => {
                const ok = await useRightTabsStore.getState().saveTab(id);
                if (ok) {
                  setDeletedPrompt(null);
                  doClose(id);
                }
              })();
            }}
          >
            {t.save}
          </Button>,
        ]}
      >
        {t.fileDeletedSavePrompt}
      </Modal>
    </aside>
  );
}

export default RightPane;
