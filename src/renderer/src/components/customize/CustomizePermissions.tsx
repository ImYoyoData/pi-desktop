import { useEffect, type ReactNode } from "react";
import { Radio } from "antd";
import {
  PERMISSION_PROFILES,
  type PermissionProfile,
} from "../../../../shared/permissions";
import { usePermissionsStore } from "@renderer/stores/permissions";
import { SettingsGroup } from "@renderer/components/customize/SettingsGroup";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { Messages } from "@renderer/i18n";
import styles from "./CustomizePermissions.module.css";

function profileLabel(t: Messages, value: PermissionProfile): string {
  switch (value) {
    case "ask":
      return t.permissionProfileAsk;
    case "edits":
      return t.permissionProfileEdits;
    case "auto":
      return t.permissionProfileAuto;
    default:
      return t.permissionProfileYolo;
  }
}

function profileHint(t: Messages, value: PermissionProfile): string {
  switch (value) {
    case "ask":
      return t.permissionProfileAskHint;
    case "edits":
      return t.permissionProfileEditsHint;
    case "auto":
      return t.permissionProfileAutoHint;
    default:
      return t.permissionProfileYoloHint;
  }
}

export function CustomizePermissions(): ReactNode {
  const permissions = usePermissionsStore();
  const t = useI18n();

  useEffect(() => {
    void permissions.load();
  }, []);

  function pick(value: PermissionProfile): void {
    if (value === permissions.settings.profile) return;
    void permissions.save({ ...permissions.settings, profile: value });
  }

  return (
    <div className={styles.root}>
      <SettingsGroup title={t.permissionProfileSection} hint={t.permissionProfileSectionHint}>
        <Radio.Group
          className={styles.profileGroup}
          value={permissions.settings.profile}
          onChange={(event) => pick(event.target.value as PermissionProfile)}
        >
          {PERMISSION_PROFILES.map((value) => (
            <Radio key={value} value={value} className={styles.profileRow}>
              <span className={styles.profileName}>{profileLabel(t, value)}</span>
              <span className={styles.profileHint}>{profileHint(t, value)}</span>
            </Radio>
          ))}
        </Radio.Group>
      </SettingsGroup>
    </div>
  );
}

export default CustomizePermissions;
