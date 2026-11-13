import { memo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Alert, Button, Dropdown, Input, Modal, Space, Typography } from "antd";
import { NO_OVERLAY_MOTION } from "@renderer/components/overlay-motion";
import { PullRequestIcon } from "@renderer/components/icons/PullRequestIcon";
import PiMarkIcon from "@renderer/components/icons/PiMarkIcon";
import OmpLogoIcon from "@renderer/components/icons/OmpLogoIcon";
import {
  AddOutline,
  ChatboxOutline,
  ChevronDownOutline,
  ChevronForwardOutline,
  EllipsisHorizontalOutline,
  OptionsOutline,
  SettingsOutline,
} from "@renderer/components/icons/ionicons";
import {
  AGENT_BACKENDS,
  AGENT_BACKEND_LABELS,
  type AgentBackend,
} from "../../../shared/agent-backend";
import { useLayoutStore } from "@renderer/stores/layout";
import { useSessionSidebar } from "./session-sidebar/use-session-sidebar";
import { SESSION_VISIBLE_LIMIT } from "./session-sidebar/sidebar-model";
import { ArchivedSessionsModal } from "./session-sidebar/ArchivedSessionsModal";
import styles from "./SessionSidebar.module.css";

/** 两套后端各自的品牌图标。 */
const BACKEND_ICONS: Record<
  AgentBackend,
  (props: { size?: number }) => ReactNode
> = {
  pi: PiMarkIcon,
  omp: OmpLogoIcon,
};

export function SessionSidebar(): ReactNode {
  const {
    t,
    activeBackend,
    switchBackend,
    onNewAgent,
    showStuckRecovery,
    onKill,
    onRestart,
    workspaceCollapsed,
    setWorkspaceCollapsed,
    view,
    moreMenuItems,
    onMoreMenuSelect,
    onAddWorkspace,
    taskRows,
    renderSessionRow,
    workspaceName,
    listedRoots,
    visibleTreeItemsFor,
    sessionsFor,
    expanded,
    onWorkspaceClick,
    openWorkspaceCtx,
    onNewAgentForWorkspace,
    onWorkspaceMore,
    workspace,
    sessionsStore,
    workspacePaths,
    workspaceTreeEl,
    sessionListExpanded,
    selectMode,
    sessionListRef,
    hiddenSessionCount,
    toggleSessionListExpanded,
    collapsibleSessionCount,
    exitSelectMode,
    selectedSessionIds,
    archiveSelectedSessions,
    deleteSelectedSessions,
    openArchivedList,
    renameOpen,
    submitRename,
    setRenameOpen,
    renameDraft,
    setRenameDraft,
    wsRenameOpen,
    submitWorkspaceRename,
    setWsRenameOpen,
    wsRenameDraft,
    setWsRenameDraft,
    archivedOpen,
    setArchivedOpen,
    archivedFilteredRows,
    archivedQuery,
    setArchivedQuery,
    archivedSelected,
    onArchivedRowClick,
    toggleArchivedSelect,
    restoreSelectedArchived,
    deleteSelectedArchived,
    ctx,
    ctxItems,
    onCtxSelect,
  } = useSessionSidebar();

  return (
    <aside className="sidebar">
      <div className={styles.topActions}>
        <Dropdown
          {...NO_OVERLAY_MOTION}
          trigger={["click"]}
          menu={{
            selectable: true,
            selectedKeys: [activeBackend],
            items: AGENT_BACKENDS.map((backend) => ({
              key: backend,
              label: (
                <span className={styles.backendMenuLabel}>
                  {BACKEND_ICONS[backend]({ size: 14 })}
                  <span>{AGENT_BACKEND_LABELS[backend]}</span>
                </span>
              ),
              // 选中态用项目自己的中性灰底，避免 antd 默认的深蓝高亮与整体配色打架。
              style:
                backend === activeBackend
                  ? { backgroundColor: "var(--bg-selected)", fontWeight: 600 }
                  : undefined,
            })),
            onClick: ({ key }) => void switchBackend(key as AgentBackend),
          }}
        >
          <Button
            type="text"
            size="small"
            className={`pi-interactive ${styles.topBtn}`}
            styles={{ root: { justifyContent: "flex-start" } }}
            title={t.workspaceBackend}
          >
            <span className={styles.btnContent}>
              {BACKEND_ICONS[activeBackend]({ size: 14 })}
              <span className={styles.btnLabel}>
                {AGENT_BACKEND_LABELS[activeBackend]}
              </span>
            </span>
          </Button>
        </Dropdown>
        <Button
          type="text"
          size="small"
          className={`pi-interactive ${styles.topBtn}`}
          styles={{ root: { justifyContent: "flex-start" } }}
          onClick={() => void onNewAgent()}
        >
          <span className={styles.btnContent}>
            <ChatboxOutline size={15} />
            <span className={styles.btnLabel}>{t.newSessionAction}</span>
          </span>
        </Button>
        <Button
          type="text"
          size="small"
          className={`pi-interactive ${styles.topBtn}`}
          styles={{ root: { justifyContent: "flex-start" } }}
          title={t.pullRequests}
          onClick={() => useLayoutStore.getState().showPullRequests()}
        >
          <span className={styles.btnContent}>
            <PullRequestIcon size={15} />
            <span className={styles.btnLabel}>{t.pullRequests}</span>
          </span>
        </Button>
      </div>

      {showStuckRecovery ? (
        <Alert
          type="warning"
          variant="filled"
          style={{ margin: "0 8px 8px" }}
          title={t.stuckBanner}
          description={
            <Space style={{ marginTop: 6 }}>
              <Button
                size="small"
                type="primary"
                danger
                onClick={() => void onKill()}
              >
                {t.terminate}
              </Button>
              <Button size="small" onClick={() => void onRestart()}>
                {t.restart}
              </Button>
            </Space>
          }
        />
      ) : null}

      <div className={styles.sessionsPane}>
        <div className={styles.wsTools}>
          <Button
            type="text"
            size="small"
            className={`pi-interactive ${styles.wsPanelToggle}`}
            styles={{ root: { justifyContent: "flex-start" } }}
            title={t.workspacePanelProjects}
            onClick={() => setWorkspaceCollapsed((prev) => !prev)}
          >
            <span className={styles.wsPanelHead}>
              <span className={styles.wsPanelLabel}>
                {t.workspacePanelProjects}
              </span>
              <span
                className={`${styles.wsPanelChevron} ${workspaceCollapsed ? styles.wsPanelChevronSticky : ""
                  }`}
              >
                {workspaceCollapsed ? (
                  <ChevronForwardOutline size={13} />
                ) : (
                  <ChevronDownOutline size={13} />
                )}
              </span>
            </span>
          </Button>
          <div className={styles.wsToolIcons}>
            <Dropdown
              {...NO_OVERLAY_MOTION}
              trigger={["click"]}
              menu={{
                selectable: true,
                selectedKeys: [
                  `group:${view.group}`,
                  `time:${view.time}`,
                  `sort:${view.sort}`,
                ],
                items: moreMenuItems(),
                onClick: ({ key }) => void onMoreMenuSelect(key),
              }}
            >
              <Button
                type="text"
                size="small"
                title={t.moreActions}
                className={styles.wsToolBtn}
              >
                <OptionsOutline size={16} />
              </Button>
            </Dropdown>
            <Button
              type="text"
              size="small"
              title={t.openWorkspace}
              className={styles.wsToolBtn}
              onClick={() => void onAddWorkspace()}
            >
              <AddOutline size={16} />
            </Button>
          </div>
        </div>

        {view.group === "task" && !workspaceCollapsed ? (
          <div className={styles.tree}>
            <ul className={styles.sessionList}>
              {taskRows.length ? (
                taskRows.map(({ root, item }, idx) =>
                  renderSessionRow(root, item, idx, workspaceName(root)),
                )
              ) : (
                <li className={styles.emptyInline} data-no-session-drag>
                  {t.emptySessions}
                </li>
              )}
            </ul>
          </div>
        ) : listedRoots.length && !workspaceCollapsed ? (
          <div className={styles.tree}>
            <div ref={workspaceTreeEl} className={styles.wsTree}>
              {listedRoots.map((root) => {
                const treeItems = visibleTreeItemsFor(root);
                const rootSessions = sessionsFor(root);
                const expandedRoot = Boolean(expanded[root]);
                return (
                  <div key={root} data-ws-block data-root={root}>
                    <div
                      className={`${styles.wsRowWrap} ${workspace.root === root && !sessionsStore.activeId
                        ? styles.wsRowWrapActive
                        : ""
                        }`}
                    >
                      <button
                        type="button"
                        className={styles.wsRow}
                        data-ws-row
                        title={root}
                        onClick={() => void onWorkspaceClick(root)}
                        onContextMenu={(e) => openWorkspaceCtx(e, root)}
                      >
                        <span
                          className={`${styles.chevron} ${expandedRoot ? styles.chevronOpen : ""
                            }`}
                        >
                          <ChevronForwardOutline size={14} />
                        </span>
                        <Typography.Text
                          ellipsis
                          style={{ fontWeight: 600, flex: 1, minWidth: 0 }}
                        >
                          {workspaceName(root)}
                        </Typography.Text>
                      </button>
                      <Button
                        className={styles.wsAction}
                        type="text"
                        shape="circle"
                        size="small"
                        data-no-ws-drag
                        onClick={(e) => void onNewAgentForWorkspace(root, e)}
                      >
                        <ChatboxOutline size={14} />
                      </Button>
                      <Button
                        className={styles.wsAction}
                        type="text"
                        shape="circle"
                        size="small"
                        data-no-ws-drag
                        data-ws-more-trigger
                        onClick={(e) => onWorkspaceMore(e, root)}
                      >
                        <EllipsisHorizontalOutline size={14} />
                      </Button>
                    </div>

                    <ul
                      className={styles.sessionList}
                      data-no-ws-drag
                      ref={sessionListRef(root)}
                      style={{ display: expandedRoot ? undefined : "none" }}
                    >
                      {!rootSessions.length ? (
                        <li
                          className={styles.emptyInline}
                          data-no-session-drag
                        >
                          {t.emptySessions}
                        </li>
                      ) : null}
                      {treeItems.map((item, sIdx) =>
                        renderSessionRow(root, item, sIdx),
                      )}
                      {hiddenSessionCount(root) > 0 ? (
                        <li
                          className={styles.sessionExpandRow}
                          data-no-session-drag
                        >
                          <button
                            type="button"
                            className={styles.sessionExpandBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSessionListExpanded(root);
                            }}
                          >
                            {t.showMoreSessions(hiddenSessionCount(root))}
                          </button>
                        </li>
                      ) : sessionListExpanded[root] &&
                        rootSessions.length > SESSION_VISIBLE_LIMIT ? (
                        <li
                          className={styles.sessionExpandRow}
                          data-no-session-drag
                        >
                          <button
                            type="button"
                            className={styles.sessionExpandBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSessionListExpanded(root);
                            }}
                          >
                            {t.collapseSessions(collapsibleSessionCount(root))}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ) : !workspaceCollapsed ? (
          <div className={styles.empty}>
            {workspacePaths.length ? t.emptySessions : t.emptyWorkspaces}
          </div>
        ) : null}
      </div>

      <div className={styles.bottomActions}>
        <Button
          type="text"
          size="small"
          className={`pi-interactive ${styles.topBtn}`}
          styles={{ root: { justifyContent: "flex-start" } }}
          title={t.customizeSettings}
          onClick={() => {
            const layout = useLayoutStore.getState();
            layout.openCustomize(layout.customizeSection);
          }}
        >
          <span className={styles.btnContent}>
            <SettingsOutline size={15} />
            <span className={styles.btnLabel}>{t.customizeSettings}</span>
          </span>
        </Button>
      </div>

      {selectMode ? (
        <div className={styles.wsSelectBar}>
          <Button type="text" size="small" onClick={exitSelectMode}>
            {t.cancel}
          </Button>
          <Button
            type="text"
            size="small"
            disabled={!selectedSessionIds.length}
            onClick={() => void archiveSelectedSessions()}
          >
            {t.archiveMenu}
          </Button>
          <Button
            type="text"
            size="small"
            disabled={!selectedSessionIds.length}
            onClick={deleteSelectedSessions}
          >
            {t.delete}
          </Button>
          <Button
            type="text"
            size="small"
            onClick={() => void openArchivedList()}
          >
            {t.archivedSessions}
          </Button>
        </div>
      ) : null}

      <Modal
        open={renameOpen}
        title={t.renameSession}
        okText={t.save}
        cancelText={t.cancel}
        onOk={() => void submitRename().finally(() => setRenameOpen(false))}
        onCancel={() => setRenameOpen(false)}
      >
        <Input
          value={renameDraft}
          placeholder={t.sessionNamePlaceholder}
          onChange={(e) => setRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void submitRename();
          }}
        />
      </Modal>

      <Modal
        open={wsRenameOpen}
        title={t.renameProject}
        okText={t.save}
        cancelText={t.cancel}
        onOk={() =>
          void submitWorkspaceRename().finally(() => setWsRenameOpen(false))
        }
        onCancel={() => setWsRenameOpen(false)}
      >
        <Input
          value={wsRenameDraft}
          placeholder={t.renameProjectPlaceholder}
          onChange={(e) => setWsRenameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void submitWorkspaceRename();
          }}
        />
      </Modal>

      <ArchivedSessionsModal
        open={archivedOpen}
        rows={archivedFilteredRows}
        query={archivedQuery}
        selected={archivedSelected}
        t={t}
        onClose={() => setArchivedOpen(false)}
        onQueryChange={setArchivedQuery}
        onRowClick={onArchivedRowClick}
        onToggleSelect={toggleArchivedSelect}
        onRestore={() => void restoreSelectedArchived()}
        onDelete={deleteSelectedArchived}
      />

      {ctx.show
        ? createPortal(
          <div className={styles.ctxAnchor} style={{ left: ctx.x, top: ctx.y }}>
            <Dropdown
              {...NO_OVERLAY_MOTION}
              open
              trigger={[]}
              placement={ctx.placement}
              menu={{
                items: ctxItems,
                onClick: ({ key }) => void onCtxSelect(key),
              }}
            >
              <span className={styles.ctxAnchorTarget} />
            </Dropdown>
          </div>,
          document.body,
        )
        : null}
    </aside>
  );
}


export default memo(SessionSidebar);
