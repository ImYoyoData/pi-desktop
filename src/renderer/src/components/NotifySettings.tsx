import type { ReactNode } from "react";
import { Radio, Typography } from "antd";
import { useNotifyStore } from "@renderer/stores/notify";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./NotifySettings.module.css";

const ON = "on";
const OFF = "off";

export function NotifySettings(): ReactNode {
  const notify = useNotifyStore();
  const t = useI18n();

  return (
    <section className={styles.root}>
      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.notifySound}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.notifySoundHint}
          </Typography.Text>
        </div>
        <Radio.Group
          className={styles.radioGroup}
          size="small"
          value={notify.soundEnabled ? ON : OFF}
          onChange={(event) => notify.setSoundEnabled(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
        </Radio.Group>
      </div>

      <div className={styles.switchRow}>
        <div className={styles.switchLabels}>
          <Typography.Text strong>{t.notifySystem}</Typography.Text>
          <Typography.Text type="secondary" className={styles.rowHint}>
            {t.notifySystemHint}
          </Typography.Text>
        </div>
        <Radio.Group
          className={styles.radioGroup}
          size="small"
          value={notify.notifyEnabled ? ON : OFF}
          onChange={(event) => notify.setNotifyEnabled(event.target.value === ON)}
        >
          <Radio.Button value={ON}>{t.switchOn}</Radio.Button>
          <Radio.Button value={OFF}>{t.switchOff}</Radio.Button>
        </Radio.Group>
      </div>
    </section>
  );
}

export default NotifySettings;
