import type { ReactNode } from "react";
import { Button, Modal } from "antd";
import AppearancePanel from "@renderer/components/AppearancePanel";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AppearanceSettings.module.css";

type Props = {
  open: boolean;
  onClose?: () => void;
};

export function AppearanceSettings({ open, onClose }: Props): ReactNode {
  const t = useI18n();

  return (
    <Modal
      open={open}
      className="pi-settings-modal"
      width="min(520px, 92vw)"
      title={t.appearance}
      onCancel={() => onClose?.()}
      footer={
        <div className={styles.footer}>
          <Button onClick={() => onClose?.()}>{t.close}</Button>
        </div>
      }
    >
      <div className="modal-scroll">
        <AppearancePanel />
      </div>
    </Modal>
  );
}

export default AppearanceSettings;
