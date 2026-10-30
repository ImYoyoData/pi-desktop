import { useEffect, useRef, useState, type ReactNode } from "react";
import { DownloadOutline } from "@renderer/components/icons/ionicons";
import PanelLeftIcon from "@renderer/components/icons/PanelLeftIcon";
import PanelRightIcon from "@renderer/components/icons/PanelRightIcon";
import PanelBottomIcon from "@renderer/components/icons/PanelBottomIcon";
import PiLogoIcon from "@renderer/components/icons/PiLogoIcon";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useLayoutStore } from "@renderer/stores/layout";
import { useAppUpdateStore } from "@renderer/stores/app-update";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useSessionsStore } from "@renderer/stores/sessions";
import { useSessionTitle } from "@renderer/utils/use-session-title";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./TitleBar.module.css";

export function TitleBar(): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const layout = useLayoutStore();
  const showSessionTitle = useAppearanceStore((s) => s.showSessionTitle);
  const sessionTitle = useSessionTitle();
  const activeId = useSessionsStore((s) => s.activeId);

  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const renameSettled = useRef(false);

  /** 展开时对齐主区左端；侧栏收起后回落到品牌之后，避免重叠。 */
  const titleStyle = layout.leftCollapsed
    ? undefined
    : { left: `calc(${layout.leftSize}% + 16px)` };
  const titleFlow = layout.leftCollapsed ? styles.titleInFlow : "";

  function beginRename(): void {
    if (!activeId || !sessionTitle) return;
    renameSettled.current = false;
    setTitleDraft(sessionTitle);
    setRenaming(true);
  }

  /** Enter 与失焦都会走到这里，用 ref 保证只提交一次。 */
  function commitRename(): void {
    if (renameSettled.current) return;
    renameSettled.current = true;
    setRenaming(false);
    const name = titleDraft.trim();
    const row = useSessionsStore
      .getState()
      .sessions.find((s) => s.id === activeId);
    if (!activeId || !row || !name || name === sessionTitle) return;
    void useSessionsStore.getState().renameSession(activeId, row.cwd, name);
  }

  function cancelRename(): void {
    renameSettled.current = true;
    setRenaming(false);
  }

  const [platform, setPlatform] = useState<NodeJS.Platform>("win32");
  const [isMaximized, setIsMaximized] = useState(false);

  const updateStatus = useAppUpdateStore((s) => s.state.status);
  const updatePercent = useAppUpdateStore((s) => s.state.progress?.percent ?? 0);
  const updateVersion = useAppUpdateStore((s) => s.state.info?.version ?? "");
  const startUpdate = useAppUpdateStore((s) => s.download);

  /** 有新版本时标题栏出现更新入口；下载中/待安装时显示当前进度。 */
  const updateBadge = ((): string => {
    if (updateStatus === "available") return t.updateAvailable;
    if (updateStatus === "downloading") return `${updatePercent}%`;
    if (updateStatus === "ready") return t.updateReady;
    return "";
  })();

  const updateTip = ((): string => {
    if (updateStatus === "available") return t.updateAvailableTip(updateVersion);
    if (updateStatus === "downloading") return t.updateDownloadingTip(updatePercent);
    if (updateStatus === "ready") return t.updateReadyTip;
    return "";
  })();

  useEffect(() => {
    let disposed = false;
    let offMaximized: (() => void) | undefined;
    let offUnmaximized: (() => void) | undefined;

    void (async (): Promise<void> => {
      const current = await window.api.window.platform();
      if (disposed) return;
      setPlatform(current);
      if (current !== "darwin") {
        const maximized = await window.api.window.isMaximized();
        if (disposed) return;
        setIsMaximized(maximized);
        offMaximized = window.api.window.onMaximized(() => {
          setIsMaximized(true);
        });
        offUnmaximized = window.api.window.onUnmaximized(() => {
          setIsMaximized(false);
        });
      }
    })();

    return () => {
      disposed = true;
      offMaximized?.();
      offUnmaximized?.();
    };
  }, []);

  async function onMinimize(): Promise<void> {
    await window.api.window.minimize();
  }

  async function onMaximize(): Promise<void> {
    await window.api.window.maximize();
  }

  async function onClose(): Promise<void> {
    await window.api.window.close();
  }

  /** 新版本未下载时直接开始下载；已在下载或待安装时重新展开桌面右下角的悬浮卡片。 */
  async function onUpdateClick(): Promise<void> {
    if (updateStatus === "available") {
      await startUpdate();
      return;
    }
    window.api.update.showToast();
  }

  return (
    <header className={`title-bar ${platform === "darwin" ? styles.mac : ""}`}>
      <div className={`${styles.drag} ${styles.trafficSpace}`} aria-hidden="true" />
      <div className={styles.brand}>
        <PiLogoIcon size={16} />
        <span className={styles.name}>{t.appName}</span>
      </div>
      {showSessionTitle && sessionTitle ? (
        renaming ? (
          <input
            className={`${styles.sessionTitleInput} ${titleFlow}`}
            style={titleStyle}
            value={titleDraft}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commitRename();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
          />
        ) : (
          <span
            className={`${styles.sessionTitle} ${titleFlow}`}
            style={titleStyle}
            title={sessionTitle}
            onDoubleClick={beginRename}
          >
            {sessionTitle}
          </span>
        )
      ) : null}
      <div className={`${styles.center} ${styles.drag}`} />
      <div className={`${styles.actions} ${styles.noDrag}`}>
        {updateBadge ? (
          <button
            type="button"
            className={styles.updateBtn}
            title={updateTip}
            aria-label={updateTip}
            onClick={() => void onUpdateClick()}
          >
            <DownloadOutline size={13} />
            <span>{updateBadge}</span>
          </button>
        ) : null}
        {workspace.root ? (
          <div className={styles.layoutControls}>
            <button
              type="button"
              className={`${styles.layoutBtn} ${layout.leftCollapsed ? "" : styles.checked}`}
              title={layout.leftCollapsed ? t.expandLeft : t.collapseLeft}
              aria-label={layout.leftCollapsed ? t.expandLeft : t.collapseLeft}
              aria-pressed={!layout.leftCollapsed}
              onClick={() => useLayoutStore.getState().toggleLeftCollapsed()}
            >
              <PanelLeftIcon size={16} off={layout.leftCollapsed} />
            </button>
            <button
              type="button"
              className={`${styles.layoutBtn} ${layout.bottomCollapsed ? "" : styles.checked}`}
              title={layout.bottomCollapsed ? t.expandBottom : t.collapseBottom}
              aria-label={layout.bottomCollapsed ? t.expandBottom : t.collapseBottom}
              aria-pressed={!layout.bottomCollapsed}
              onClick={() => useLayoutStore.getState().toggleBottomCollapsed()}
            >
              <PanelBottomIcon size={16} off={layout.bottomCollapsed} />
            </button>
            <button
              type="button"
              className={`${styles.layoutBtn} ${layout.rightCollapsed ? "" : styles.checked}`}
              title={layout.rightCollapsed ? t.expandRight : t.collapseRight}
              aria-label={layout.rightCollapsed ? t.expandRight : t.collapseRight}
              aria-pressed={!layout.rightCollapsed}
              onClick={() => useLayoutStore.getState().toggleRightCollapsed()}
            >
              <PanelRightIcon size={16} off={layout.rightCollapsed} />
            </button>
          </div>
        ) : null}
      </div>
      {platform !== "darwin" ? (
        <div className={`${styles.windowControls} ${styles.noDrag}`}>
          <button
            type="button"
            className={styles.wcBtn}
            title={t.minimize}
            aria-label={t.minimize}
            onClick={() => void onMinimize()}
          >
            <svg
              className={styles.wcIcon}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <line
                x1="0.5"
                y1="5"
                x2="9.5"
                y2="5"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
          <button
            type="button"
            className={styles.wcBtn}
            title={isMaximized ? t.restore : t.maximize}
            aria-label={isMaximized ? t.restore : t.maximize}
            onClick={() => void onMaximize()}
          >
            {isMaximized ? (
              <svg
                className={styles.wcIcon}
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <rect
                  x="2.5"
                  y="2.5"
                  width="7"
                  height="7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <rect
                  x="0.5"
                  y="0.5"
                  width="7"
                  height="7"
                  fill="var(--wc-restore-fill, var(--bg-title))"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            ) : (
              <svg
                className={styles.wcIcon}
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
              >
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className={`${styles.wcBtn} ${styles.closeBtn}`}
            title={t.close}
            aria-label={t.close}
            onClick={() => void onClose()}
          >
            <svg
              className={styles.wcIcon}
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <line
                x1="0.5"
                y1="9.5"
                x2="9.5"
                y2="0.5"
                stroke="currentColor"
                strokeWidth="1"
              />
              <line
                x1="9.5"
                y1="9.5"
                x2="0.5"
                y2="0.5"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
        </div>
      ) : null}
    </header>
  );
}

export default TitleBar;
