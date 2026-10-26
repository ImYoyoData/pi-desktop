import type { ReactNode } from "react";
import { Select } from "antd";
import { useSessionStatsStore } from "@renderer/stores/session-stats";
import { useSendShortcutStore, type SendShortcutMode } from "@renderer/stores/send-shortcut";
import type { SessionTpsMode } from "@renderer/utils/session-stats";
import {
  SettingsGroup,
  SettingsRow,
} from "@renderer/components/customize/SettingsGroup";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./GeneralSettings.module.css";

export function GeneralSettings(): ReactNode {
  const t = useI18n();
  const tpsMode = useSessionStatsStore((state) => state.tpsMode);
  const setTpsMode = useSessionStatsStore((state) => state.setTpsMode);
  const sendShortcut = useSendShortcutStore((state) => state.mode);
  const setSendShortcut = useSendShortcutStore((state) => state.setMode);

  const tpsModeOptions: { label: string; value: SessionTpsMode }[] = [
    { label: t.commonTpsModeStreaming, value: "streaming" },
    { label: t.commonTpsModeEndToEnd, value: "end-to-end" },
  ];

  const sendShortcutOptions: { label: string; value: SendShortcutMode }[] = [
    { label: t.commonSendShortcutEnter, value: "enter" },
    { label: t.commonSendShortcutShiftEnter, value: "shift-enter" },
    { label: t.commonSendShortcutModEnter, value: "ctrl-enter" },
  ];

  return (
    <div className={styles.root}>
      <SettingsGroup>
        <SettingsRow label={t.commonSendShortcut} description={t.commonSendShortcutHint}>
          <Select
            value={sendShortcut}
            options={sendShortcutOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value: SendShortcutMode) => setSendShortcut(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.commonTpsMode} description={t.commonTpsModeHint}>
          <Select
            value={tpsMode}
            options={tpsModeOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value: SessionTpsMode) => setTpsMode(value)}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default GeneralSettings;
