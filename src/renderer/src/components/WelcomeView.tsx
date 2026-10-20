import { useEffect, type ReactNode } from "react";
import { Button, List, Typography } from "antd";
import { useWorkspaceStore } from "@renderer/stores/workspace";
import { useI18n } from "@renderer/i18n/use-i18n";
import logoUrl from "@renderer/assets/logo.svg";
import { FolderOpenOutline, FolderOutline } from "@renderer/components/icons/ionicons";
import styles from "./WelcomeView.module.css";

function workspaceName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts.filter(Boolean).pop() ?? path;
}

export function WelcomeView(): ReactNode {
  const workspace = useWorkspaceStore();
  const t = useI18n();

  useEffect(() => {
    void workspace.listRecentFast();
  }, []);

  function openFolder(): void {
    void workspace.openWorkspace();
  }

  function openRecent(path: string): void {
    void workspace.openWorkspacePath(path);
  }

  return (
    <section className={styles.root}>
      <div className={styles.hero}>
        <img className={styles.logo} src={logoUrl} alt="Pi Desktop" width={56} height={56} />
        <h1>{t.appName}</h1>
        <Typography.Text type="secondary">{t.openFolderHint}</Typography.Text>
        <Button
          type="primary"
          style={{ marginTop: 12 }}
          icon={<FolderOpenOutline />}
          onClick={openFolder}
        >
          {t.openFolder}
        </Button>
      </div>

      {workspace.recent.length ? (
        <div className={styles.recent}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}
          >
            {t.recent}
          </Typography.Text>
          <List
            className={styles.recentList}
            dataSource={workspace.recent}
            renderItem={(item: string) => (
              <List.Item onClick={() => openRecent(item)}>
                <List.Item.Meta
                  avatar={<FolderOutline size={18} />}
                  title={workspaceName(item)}
                  description={
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {item}
                    </Typography.Text>
                  }
                />
              </List.Item>
            )}
          />
        </div>
      ) : null}
    </section>
  );
}

export default WelcomeView;
