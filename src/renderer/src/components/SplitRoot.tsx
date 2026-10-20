import { lazy, Suspense, useEffect } from "react";
import { SplitPane, SplitPanes } from "@renderer/components/SplitPanes";
import { useLayoutStore } from "@renderer/stores/layout";
import { useWorkspaceStore } from "@renderer/stores/workspace";

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

export function SplitRoot(): React.ReactNode {
  const layout = useLayoutStore();
  const workspaceRoot = useWorkspaceStore((s) => s.root);

  useEffect(() => {
    if (workspaceRoot) useLayoutStore.getState().loadForWorkspace(workspaceRoot);
  }, [workspaceRoot]);

  /** Outer: left % of window (rest is main). */
  const outerLeftSize = layout.leftSize;
  const outerMainSize = 100 - layout.leftSize;

  /** Inner sizes as % of main (chat + right). */
  const center = layout.centerSize;
  const right = layout.rightSize;
  const sum = center + right;
  const innerPair =
    sum <= 0 ? { chat: 37.5, right: 62.5 } : { chat: (center / sum) * 100, right: (right / sum) * 100 };

  /** 聊天列（消息区）是否可见：最大化时整列让给编辑器区域。 */
  const chatVisible = !layout.editorMaximized;

  /** 最大化时聊天列默认隐藏；底栏展开时仅用该列承载面板。 */
  const chatPaneSize = layout.editorMaximized
    ? layout.bottomCollapsed
      ? 0
      : innerPair.chat
    : layout.rightCollapsed
      ? 100
      : innerPair.chat;
  const rightPaneSize = 100 - chatPaneSize;
  const chatTopSize = layout.editorMaximized
    ? layout.bottomCollapsed
      ? 100
      : 0
    : layout.bottomCollapsed
      ? 100
      : 100 - layout.bottomSize;
  const bottomPanelSize = layout.editorMaximized
    ? layout.bottomCollapsed
      ? 0
      : 100
    : layout.bottomCollapsed
      ? 0
      : layout.bottomSize;

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

  return (
    <div className="split-root">
      <SplitPanes className="panes outer" onResized={onOuterResized}>
        <SplitPane
          size={layout.leftCollapsed ? 0 : outerLeftSize}
          minSize={layout.leftCollapsed ? 0 : PANE_MIN}
          maxSize={layout.leftCollapsed ? 0 : PANE_MAX}
          className={layout.leftCollapsed ? "pane-collapsed" : undefined}
        >
          <Suspense fallback={null}>
            <SessionSidebar />
          </Suspense>
        </SplitPane>

        <SplitPane
          size={layout.leftCollapsed ? 100 : outerMainSize}
          minSize={layout.leftCollapsed ? 100 : 100 - PANE_MAX}
        >
          <SplitPanes className="panes inner" onResized={onInnerResized}>
            <SplitPane
              size={chatPaneSize}
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
                  size={chatTopSize}
                  minSize={layout.editorMaximized ? 0 : CHAT_TOP_MIN}
                  maxSize={
                    layout.editorMaximized || layout.bottomCollapsed ? 100 : 100 - PANEL_MIN
                  }
                  className={layout.editorMaximized ? "pane-collapsed" : undefined}
                >
                  {layout.centerView === "pull-requests" ? (
                    <Suspense fallback={null}>
                      <PullRequestsView />
                    </Suspense>
                  ) : (
                    <Suspense fallback={null}>
                      <ChatPanel visible={chatVisible} />
                    </Suspense>
                  )}
                </SplitPane>
                <SplitPane
                  size={bottomPanelSize}
                  minSize={layout.editorMaximized || layout.bottomCollapsed ? 0 : PANEL_MIN}
                  maxSize={layout.editorMaximized ? 100 : layout.bottomCollapsed ? 0 : PANEL_MAX}
                  className={layout.bottomCollapsed ? "pane-collapsed" : undefined}
                >
                  <Suspense fallback={null}>
                    <BottomPanel />
                  </Suspense>
                </SplitPane>
              </SplitPanes>
            </SplitPane>
            <SplitPane
              size={layout.rightCollapsed && !layout.editorMaximized ? 0 : rightPaneSize}
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
              <Suspense fallback={null}>
                <RightPane />
              </Suspense>
            </SplitPane>
          </SplitPanes>
        </SplitPane>
      </SplitPanes>
    </div>
  );
}

export default SplitRoot;
