import { lazy, Suspense, useEffect } from "react";
import { SplitPane, SplitPanes } from "@renderer/components/SplitPanes";
import ViewPresence from "@renderer/components/ViewPresence";
import { useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { splitPaneSizes } from "@renderer/utils/split-layout";

const SessionSidebar = lazy(() => import("@renderer/components/SessionSidebar"));
const ChatPanel = lazy(() => import("@renderer/components/ChatPanel"));
const RightPane = lazy(() => import("@renderer/components/RightPane"));
const PullRequestsView = lazy(() => import("@renderer/components/PullRequestsView"));
const BottomPanel = lazy(() => import("@renderer/components/BottomPanel"));

/** Nested splits: outer left↔main, inner chat↔right, chat area chat↔bottom panel. */
const PANE_MIN = 15;
const CHAT_MIN = 12;
const PANE_MAX = 70;
/** Chat area (top) vs bottom panel share the centre column. */
const CHAT_TOP_MIN = 25;
const PANEL_MIN = 18;
const PANEL_MAX = 75;

/** 胶囊卡片：面板内容与分栏边界之间留出浮动间隙。 */
function Capsule({ children }: { children: React.ReactNode }): React.ReactNode {
  return <div className="pane-capsule">{children}</div>;
}

export function SplitRoot(): React.ReactNode {
  const layout = useLayoutStore();
  const workspaceRoot = useWorkspaceStore((s) => s.root);

  useEffect(() => {
    if (workspaceRoot) useLayoutStore.getState().loadForWorkspace(workspaceRoot);
  }, [workspaceRoot]);

  /** Outer: left % of window (rest is main). */
  const sizes = splitPaneSizes(layout);

  function onOuterResized(payload: { panes: { size: number }[] }): void {
    if (layout.leftCollapsed || payload.panes.length < 2) return;
    const leftPct = payload.panes[0].size;
    const mainPct = 100 - leftPct;
    const ratio =
      layout.centerSize + layout.rightSize > 0
        ? layout.centerSize / (layout.centerSize + layout.rightSize)
        : 0.375;
    const centerSize = mainPct * ratio;
    const rightSize = mainPct - centerSize;
    layout.setPaneSizes(leftPct, centerSize, rightSize);
  }

  function onInnerResized(payload: { panes: { size: number }[] }): void {
    if (layout.rightCollapsed || layout.editorMaximized || payload.panes.length < 2) return;
    const chatOfMain = payload.panes[0].size;
    const rightOfMain = payload.panes[1].size;
    const mainPct = layout.leftCollapsed ? 100 : 100 - layout.leftSize;
    const centerSize = (chatOfMain / 100) * mainPct;
    const rightSize = (rightOfMain / 100) * mainPct;
    layout.setPaneSizes(layout.leftSize, centerSize, rightSize);
  }

  /** Bottom panel height is relative to the centre column. */
  function onChatResized(payload: { panes: { size: number }[] }): void {
    if (layout.bottomCollapsed || payload.panes.length < 2) return;
    const bottomOfColumn = payload.panes[1].size;
    layout.setBottomSize(bottomOfColumn);
  }

  /** 拉取请求页是主区全屏视图，会盖住聊天列与右侧面板。 */
  const prOpen = layout.centerView === "pull-requests";
  const leftHidden = sizes.leftHidden;

  return (
    <div className="split-root">
      <SplitPanes className="panes outer" onResized={onOuterResized}>
        <SplitPane
          size={sizes.outerLeft}
          minSize={leftHidden ? 0 : PANE_MIN}
          maxSize={leftHidden ? 0 : PANE_MAX}
          className={leftHidden ? "pane-collapsed" : undefined}
        >
          <Suspense fallback={null}>
            <SessionSidebar />
          </Suspense>
        </SplitPane>

        <SplitPane
          size={sizes.outerMain}
          minSize={leftHidden ? 100 : 100 - PANE_MAX}
        >
          <SplitPanes
            className={`panes inner${prOpen ? " pane-collapsed" : ""}`}
            onResized={onInnerResized}
          >
            <SplitPane
              size={sizes.chat}
              minSize={layout.editorMaximized ? 0 : CHAT_MIN}
              maxSize={layout.editorMaximized || layout.rightCollapsed ? 100 : PANE_MAX}
              className={
                layout.editorMaximized && layout.bottomCollapsed ? "pane-collapsed" : undefined
              }
            >
              <SplitPanes
                horizontal
                className={`panes chat-split${
                  layout.editorMaximized || layout.bottomCollapsed ? " panel-collapsed" : ""
                }`}
                onResized={onChatResized}
              >
                <SplitPane
                  size={sizes.chatTop}
                  minSize={layout.editorMaximized ? 0 : CHAT_TOP_MIN}
                  maxSize={
                    layout.editorMaximized || layout.bottomCollapsed ? 100 : 100 - PANEL_MIN
                  }
                  className={layout.editorMaximized ? "pane-collapsed" : undefined}
                >
                  <Suspense fallback={null}>
                    <ChatPanel visible={sizes.chatVisible} />
                  </Suspense>
                </SplitPane>
                <SplitPane
                  size={sizes.bottomPanel}
                  minSize={layout.editorMaximized || layout.bottomCollapsed ? 0 : PANEL_MIN}
                  maxSize={layout.editorMaximized ? 100 : layout.bottomCollapsed ? 0 : PANEL_MAX}
                  className={layout.bottomCollapsed ? "pane-collapsed" : undefined}
                >
                  <Capsule>
                    <Suspense fallback={null}>
                      <BottomPanel />
                    </Suspense>
                  </Capsule>
                </SplitPane>
              </SplitPanes>
            </SplitPane>
            <SplitPane
              size={layout.rightCollapsed && !layout.editorMaximized ? 0 : sizes.rightPane}
              minSize={layout.rightCollapsed || layout.editorMaximized ? 0 : PANE_MIN}
              maxSize={
                layout.rightCollapsed && !layout.editorMaximized
                  ? 0
                  : layout.editorMaximized
                    ? 100
                    : PANE_MAX
              }
              className={
                layout.rightCollapsed && !layout.editorMaximized ? "pane-collapsed" : undefined
              }
            >
              <Capsule>
                <Suspense fallback={null}>
                  <RightPane />
                </Suspense>
              </Capsule>
            </SplitPane>
          </SplitPanes>
          <ViewPresence
            viewId={prOpen ? "pull-requests" : null}
            render={() => (
              <Suspense fallback={null}>
                <PullRequestsView />
              </Suspense>
            )}
          />
        </SplitPane>
      </SplitPanes>
    </div>
  );
}

export default SplitRoot;
