import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import BrowserPage from "@renderer/components/BrowserPage";
import ChangesPage from "@renderer/components/ChangesPage";
import FilesPage from "@renderer/components/FilesPage";
import { useAgentRunsStore } from "@renderer/stores/agent-runs";
import { useLayoutStore } from "@renderer/stores/layout";
import { useKeybindingsStore } from "@renderer/stores/keybindings";
import { usePreviewStore } from "@renderer/stores/preview";
import { DOCK_PREF_KEYS, useRightDockStore, type RightDockView } from "@renderer/stores/right-dock";
import { useRightTabsStore } from "@renderer/stores/right-tabs";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import * as prefs from "@renderer/utils/prefs";
import { registerStateApplier } from "@renderer/utils/state-sync";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./RightPane.module.css";

const SIDE_WIDTH_KEY = "pi-desktop:right-dock-width:v1";
const SIDE_MIN_WIDTH = 110;
const SIDE_MAX_WIDTH = 480;
const SIDE_DEFAULT_WIDTH = 180;

function readSideWidth(): number {
  try {
    const n = Number(prefs.getItem(SIDE_WIDTH_KEY));
    if (Number.isFinite(n)) return Math.min(SIDE_MAX_WIDTH, Math.max(SIDE_MIN_WIDTH, n));
  } catch {
    // ignore
  }
  return SIDE_DEFAULT_WIDTH;
}

export function RightPane(): ReactNode {
  const t = useI18n();
  const view = useRightDockStore((s) => s.view);
  const rightCollapsed = useLayoutStore((s) => s.rightCollapsed);
  const openSignal = usePreviewStore((s) => s.openSignal);
  const workspaceRoot = useWorkspaceStore((s) => s.root);

  const [sideWidth, setSideWidth] = useState(readSideWidth);
  const openSignalRef = useRef(openSignal);

  function showView(next: RightDockView): void {
    const layoutState = useLayoutStore.getState();
    if (layoutState.rightCollapsed) layoutState.toggleRightCollapsed();
    useRightDockStore.getState().show(next);
  }

  function onLayoutKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
    if (event.code === "KeyE") {
      event.preventDefault();
      useLayoutStore.getState().toggleEditorMaximized();
    } else if (event.code === "KeyL") {
      event.preventDefault();
      useLayoutStore.getState().toggleRightCollapsed();
    }
  }

  useEffect(() => {
    return registerStateApplier((change) => {
      if (change.scope !== "prefs") return;
      const keys = change.keys ?? [];
      if (keys.some((key) => DOCK_PREF_KEYS.includes(key))) {
        useRightDockStore.getState().refreshFromPrefs();
      }
      if (keys.includes(SIDE_WIDTH_KEY)) setSideWidth(readSideWidth());
    });
  }, []);

  useEffect(() => {
    try {
      prefs.setItem(SIDE_WIDTH_KEY, String(sideWidth));
    } catch {
      // ignore
    }
  }, [sideWidth]);

  useEffect(() => {
    if (openSignalRef.current === openSignal) return;
    openSignalRef.current = openSignal;
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
  }, [openSignal]);

  useEffect(() => {
    window.addEventListener("keydown", onLayoutKeydown);
    const keybindings = useKeybindingsStore.getState();
    keybindings.register("right-pane-files", () => showView("files"));
    void useAgentRunsStore.getState().refresh(useWorkspaceStore.getState().root);

    return () => {
      useKeybindingsStore.getState().unregister("right-pane-files");
      window.removeEventListener("keydown", onLayoutKeydown);
    };
  }, []);

  const workspaceRootRef = useRef(workspaceRoot);

  useEffect(() => {
    if (workspaceRootRef.current === workspaceRoot) return;
    workspaceRootRef.current = workspaceRoot;
    void useAgentRunsStore.getState().refresh(workspaceRoot);
  }, [workspaceRoot]);

  function pageStyle(id: RightDockView): React.CSSProperties | undefined {
    return view === id && !rightCollapsed ? undefined : { display: "none" };
  }

  return (
    <aside className={`right-pane ${styles.root}`}>
      <div className={styles.body}>
        <div className={styles.page} style={pageStyle("files")}>
          <FilesPage
            visible={view === "files" && !rightCollapsed}
            sideWidth={sideWidth}
            sideMinWidth={SIDE_MIN_WIDTH}
            sideMaxWidth={SIDE_MAX_WIDTH}
            onSideWidthChange={setSideWidth}
          />
        </div>
        <div className={styles.page} style={pageStyle("changes")}>
          <ChangesPage
            visible={view === "changes" && !rightCollapsed}
            sideWidth={sideWidth}
            sideMinWidth={SIDE_MIN_WIDTH}
            sideMaxWidth={SIDE_MAX_WIDTH}
            onSideWidthChange={setSideWidth}
          />
        </div>
        <div className={styles.page} style={pageStyle("browser")}>
          <BrowserPage visible={view === "browser" && !rightCollapsed} />
        </div>
      </div>
    </aside>
  );
}

export default memo(RightPane);
