import type { ReactNode } from "react";
import { useNotifyStore } from "@renderer/stores/notify";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import styles from "./NotifySettings.module.css";

export function NotifySettings(): ReactNode {
  const notify = useNotifyStore();
  const t = useI18n();

  return (
    <div className={styles.root}>
      <SettingsGroup>
        <SettingsRow label={t.notifySound} description={t.notifySoundHint}>
          <SettingsSwitch
            checked={notify.soundEnabled}
            label={t.notifySound}
            onChange={(value) => notify.setSoundEnabled(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.notifySystem} description={t.notifySystemHint}>
          <SettingsSwitch
            checked={notify.notifyEnabled}
            label={t.notifySystem}
            onChange={(value) => notify.setNotifyEnabled(value)}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default NotifySettings;
