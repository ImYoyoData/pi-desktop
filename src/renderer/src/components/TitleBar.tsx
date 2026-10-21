import { useEffect, useState, type ReactNode } from "react";
import { Button, Space } from "antd";
import {
  ArrowUpCircleOutline,
  LogoGithub,
} from "@renderer/components/icons/ionicons";
import type { WindowRunIdentity } from "../../../shared/protocol";
import PanelLeftIcon from "@renderer/components/icons/PanelLeftIcon";
import PanelRightIcon from "@renderer/components/icons/PanelRightIcon";
import PanelBottomIcon from "@renderer/components/icons/PanelBottomIcon";
import PiLogoIcon from "@renderer/components/icons/PiLogoIcon";
import UpdateCard from "@renderer/components/UpdateCard";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useUpdateStore } from "@renderer/stores/update";
import { useLayoutStore } from "@renderer/stores/layout";
import { useAppearanceStore } from "@renderer/stores/appearance";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./TitleBar.module.css";

export function TitleBar(): ReactNode {
  const t = useI18n();
  const workspace = useWorkspaceStore();
  const update = useUpdateStore();
  const layout = useLayoutStore();
  const appearance = useAppearanceStore();

  const [platform, setPlatform] = useState<NodeJS.Platform>("win32");
  const [isMaximized, setIsMaximized] = useState(false);
  const [identity, setIdentity] = useState<WindowRunIdentity | null>(null);

  useEffect(() => {
    let disposed = false;
    let offUpdateProgress: (() => void) | undefined;
    let offMaximized: (() => void) | undefined;
    let offUnmaximized: (() => void) | undefined;

    void (async (): Promise<void> => {
      const current = await window.api.window.platform();
      if (disposed) return;
      setPlatform(current);
      if (current === "win32") {
        const info = await window.api.window.identity();
        if (disposed) return;
        setIdentity(info);
      }
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
      offUpdateProgress = window.api.update.onProgress((p) => {
        useUpdateStore.getState().onProgress(p);
      });
      void useUpdateStore.getState().checkOnStartup();
    })();

    return () => {
      disposed = true;
      offUpdateProgress?.();
      offMaximized?.();
      offUnmaximized?.();
    };
  }, []);

  const privilegeLabel = ((): string => {
    if (!identity) return "";
    if (identity.level === "admin") return `(${t.privilegeAdmin})`;
    if (identity.level === "system") return `(${t.privilegeSystem})`;
    return `(${identity.username})`;
  })();

  async function onMinimize(): Promise<void> {
    await window.api.window.minimize();
  }

  async function onMaximize(): Promise<void> {
    await window.api.window.maximize();
  }

  async function onClose(): Promise<void> {
    await window.api.window.close();
  }

  async function openGithub(): Promise<void> {
    await window.api.update.openGithub();
  }

  async function onUpdateClick(): Promise<void> {
    await useUpdateStore.getState().openUpdateCard();
  }

  return (
    <>
      <header className={`title-bar ${platform === "darwin" ? styles.mac : ""}`}>
        <div className={`${styles.drag} ${styles.trafficSpace}`} aria-hidden="true" />
        <div className={styles.brand}>
          <PiLogoIcon size={16} />
          <span className={styles.name}>{t.appName}</span>
          {identity && platform === "win32" && appearance.showPrivilegeLevel ? (
            <span className={styles.privilege}>{privilegeLabel}</span>
          ) : null}
        </div>
        <div className={`${styles.center} ${styles.drag}`} />
        <div className={`${styles.actions} ${styles.noDrag}`}>
          <Space size={4}>
            <Button
              type="text"
              shape="circle"
              size="small"
              className={styles.updateBtn}
              loading={update.checking && !update.modalOpen}
              title={t.checkUpdate}
              icon={<ArrowUpCircleOutline />}
              onClick={() => void onUpdateClick()}
            >
              {update.available ? (
                <span className={styles.updateDot} aria-hidden="true" />
              ) : null}
            </Button>
            <Button
              type="text"
              shape="circle"
              size="small"
              onClick={() => void openGithub()}
              icon={<LogoGithub />}
            />
          </Space>
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
                  y1="0.5"
                  x2="9.5"
                  y2="9.5"
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <line
                  x1="9.5"
                  y1="0.5"
                  x2="0.5"
                  y2="9.5"
                  stroke="currentColor"
                  strokeWidth="1"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </header>
      <UpdateCard />
    </>
  );
}

export default TitleBar;
