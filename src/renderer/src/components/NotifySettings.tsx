import type { ReactNode } from "react";
import { Select } from "antd";
import { UPDATE_CHECK_INTERVAL_HOURS } from "../../../shared/update";
import { useNotifyStore } from "@renderer/stores/notify";
import { useUpdatePrefsStore } from "@renderer/stores/update-prefs";
import { useI18n } from "@renderer/i18n/use-i18n";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import styles from "./NotifySettings.module.css";

export function NotifySettings(): ReactNode {
  const notify = useNotifyStore();
  const autoCheck = useUpdatePrefsStore((state) => state.autoCheck);
  const intervalHours = useUpdatePrefsStore((state) => state.intervalHours);
  const setAutoCheck = useUpdatePrefsStore((state) => state.setAutoCheck);
  const setIntervalHours = useUpdatePrefsStore((state) => state.setIntervalHours);
  const t = useI18n();

  const intervalOptions = UPDATE_CHECK_INTERVAL_HOURS.map((hours) => ({
    label: t.notifyUpdateIntervalHours(hours),
    value: hours,
  }));

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

      <SettingsGroup>
        <SettingsRow
          label={t.notifyUpdateAutoCheck}
          description={t.notifyUpdateAutoCheckHint}
        >
          <SettingsSwitch
            checked={autoCheck}
            label={t.notifyUpdateAutoCheck}
            onChange={setAutoCheck}
          />
        </SettingsRow>

        <SettingsRow
          label={t.notifyUpdateInterval}
          description={t.notifyUpdateIntervalHint}
        >
          <Select
            value={intervalHours}
            options={intervalOptions}
            size="small"
            className={styles.settingSelect}
            onChange={setIntervalHours}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default NotifySettings;
