import type { ReactNode } from "react";
import { Button } from "antd";
import { useNotifyStore } from "@renderer/stores/notify";
import { useAppUpdateStore } from "@renderer/stores/app-update";
import { useDialog } from "@renderer/services/feedback";
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
  const dialog = useDialog();
  const forceUpdate = useAppUpdateStore((s) => s.forceUpdate);

  /** 真实跑一遍自动更新：下载最新安装包，装好后程序会退出并交给安装器。 */
  function onTestUpdate(): void {
    dialog.warning({
      title: t.updateTestLabel,
      content: t.updateTestConfirm,
      positiveText: t.updateTestConfirmOk,
      negativeText: t.updateTestCancel,
      onPositiveClick: () => {
        void forceUpdate();
      },
    });
  }

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

      <SettingsGroup title={t.updateTestGroup}>
        <SettingsRow label={t.updateTestLabel} description={t.updateTestHint}>
          <Button size="small" type="primary" onClick={onTestUpdate}>
            {t.updateTestStart}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default NotifySettings;
