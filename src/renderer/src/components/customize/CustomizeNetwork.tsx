import type { ReactNode } from "react";
import { Button } from "antd";
import ProxySettings from "@renderer/components/ProxySettings";
import {
  SettingsGroup,
  SettingsRow,
} from "@renderer/components/customize/SettingsGroup";
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

      <SettingsGroup>
        <SettingsRow
          label={t.securityOpenDevTools}
          description={t.securityOpenDevToolsHint}
        >
          <Button size="small" onClick={() => void onOpenDevTools()}>
            {t.open}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default CustomizeNetwork;
