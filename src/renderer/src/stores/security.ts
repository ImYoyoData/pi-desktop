import { defineStore } from "pinia";
import { ref } from "vue";
import {
  DEFAULT_PERMISSION_PROFILE,
  PERMISSION_PROFILES,
  type DesktopSecuritySettings,
  type PermissionProfile,
} from "../../../shared/desktop-security";
import { t } from "@renderer/i18n";

export function permissionProfileLabel(value: PermissionProfile): string {
  switch (value) {
    case "ask":
      return t.permissionProfileAsk;
    case "edits":
      return t.permissionProfileEdits;
    case "auto":
      return t.permissionProfileAuto;
    case "yolo":
      return t.permissionProfileYolo;
    default: {
      const _never: never = value;
      return String(_never);
    }
  }
}

export function permissionProfileHint(value: PermissionProfile): string {
  switch (value) {
    case "ask":
      return t.permissionProfileAskHint;
    case "edits":
      return t.permissionProfileEditsHint;
    case "auto":
      return t.permissionProfileAutoHint;
    case "yolo":
      return t.permissionProfileYoloHint;
    default: {
      const _never: never = value;
      return String(_never);
    }
  }
}

export function permissionProfileOptions(): {
  value: PermissionProfile;
  label: string;
  hint: string;
}[] {
  return PERMISSION_PROFILES.map((value) => ({
    value,
    label: permissionProfileLabel(value),
    hint: permissionProfileHint(value),
  }));
}

/** 全局权限档位：输入框选择器与设置面板共用的唯一状态。 */
export const useSecurityStore = defineStore("security", () => {
  const profile = ref<PermissionProfile>(DEFAULT_PERMISSION_PROFILE);
  const loaded = ref(false);

  async function load(): Promise<void> {
    const next = await window.api.security.get();
    profile.value = next.profile;
    loaded.value = true;
  }

  /** 读取-改-写，避免与其它入口的保存互相覆盖。 */
  async function setProfile(next: PermissionProfile): Promise<void> {
    const current = await window.api.security.get();
    const payload: DesktopSecuritySettings = { ...current, profile: next };
    await window.api.security.set(payload);
    profile.value = next;
  }

  return { profile, loaded, load, setProfile };
});
