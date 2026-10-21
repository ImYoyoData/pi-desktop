import type { ReactNode } from "react";
import { Button, Typography } from "antd";
import ProxySettings from "@renderer/components/ProxySettings";
import { useMessage } from "@renderer/services/feedback";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./CustomizeNetwork.module.css";

export function CustomizeNetwork(): ReactNode {
  const message = useMessage();
  const t = useI18n();

  async function onOpenDevTools(): Promise<void> {
    try {
      await window.api.window.openDevTools();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t.cannotOpenDevtools);
    }
  }

  return (
    <div className={styles.customizeNetwork}>
      <ProxySettings />

      <div className={styles.networkDivider} />

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.securityOpenDevTools}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.securityOpenDevToolsHint}
          </Typography.Text>
        </div>
        <Button size="small" onClick={() => void onOpenDevTools()}>
          {t.open}
        </Button>
      </div>
    </div>
  );
}

export default CustomizeNetwork;
