import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "antd";
import {
  BUILTIN_SHORTCUTS,
  KEYBINDINGS,
  useKeybindingsStore,
  type BuiltinShortcutGroup,
  type KeybindingId,
} from "@renderer/stores/keybindings";
import { keyboardEventToAccelerator } from "../../../shared/hotkey";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import { useI18n } from "@renderer/i18n/use-i18n";
import type { Messages } from "@renderer/i18n";
import styles from "./KeybindingsSettings.module.css";

const BUILTIN_GROUP_TITLE: Record<BuiltinShortcutGroup, keyof Messages> = {
  app: "keybindingsBuiltinApp",
  composer: "keybindingsBuiltinComposer",
  menu: "keybindingsBuiltinMenu",
};

export function KeybindingsSettings(): ReactNode {
  const keybindings = useKeybindingsStore();
  const t = useI18n();
  const [recording, setRecording] = useState<KeybindingId | null>(null);
  const recordingRef = useRef<KeybindingId | null>(null);

  function startRecording(id: KeybindingId): void {
    recordingRef.current = id;
    setRecording(id);
    useKeybindingsStore.getState().setCapturing(true);
  }

  function stopRecording(): void {
    recordingRef.current = null;
    setRecording(null);
    useKeybindingsStore.getState().setCapturing(false);
  }

  useEffect(() => {
    /** 录制改键：Esc 取消，只按修饰键时继续等待。 */
    function onRecordKeydown(event: KeyboardEvent): void {
      const current = recordingRef.current;
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stopRecording();
        return;
      }
      const accel = keyboardEventToAccelerator(event);
      if (!accel) return;
      if (useKeybindingsStore.getState().setAccel(current, accel)) stopRecording();
    }

    window.addEventListener("keydown", onRecordKeydown, true);
    return () => {
      window.removeEventListener("keydown", onRecordKeydown, true);
      useKeybindingsStore.getState().setCapturing(false);
    };
  }, []);

  const builtinSections = (
    Object.keys(BUILTIN_GROUP_TITLE) as BuiltinShortcutGroup[]
  ).map((group) => ({
    group,
    title: t[BUILTIN_GROUP_TITLE[group]] as string,
    items: BUILTIN_SHORTCUTS.filter((item) => item.group === group),
  }));

  function hintOf(id: KeybindingId): string {
    return useKeybindingsStore.getState().conflicts.has(id) ? t.keybindingsConflict : "";
  }

  return (
    <div className={styles.keysPanel}>
      <SettingsGroup>
        <SettingsRow label={t.keybindingsMaster} description={t.keybindingsMasterHint}>
          <SettingsSwitch
            checked={keybindings.master}
            label={t.keybindingsMaster}
            onChange={(value) => keybindings.setMaster(value)}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.keybindingsCustomGroup}>
        {KEYBINDINGS.map((def) => {
          const isRecording = recording === def.id;
          const conflict = keybindings.conflicts.has(def.id);
          const disabled = !keybindings.enabledOf(def.id) || !keybindings.master;
          return (
            <div
              key={def.id}
              className={disabled ? `${styles.row} ${styles.off}` : styles.row}
            >
              <span className={styles.label}>{t[def.labelKey] as string}</span>
              <span
                className={`${styles.keys}${isRecording ? ` ${styles.recording}` : ""}${conflict ? ` ${styles.conflict}` : ""}`}
                title={isRecording ? t.keybindingsRecordingHint : hintOf(def.id)}
              >
                {isRecording
                  ? t.keybindingsRecording
                  : keybindings.labelOf(def) || t.keybindingsUnset}
              </span>
              <Button
                size="small"
                type="text"
                disabled={isRecording || !keybindings.master}
                onClick={() => startRecording(def.id)}
              >
                {t.keybindingsChange}
              </Button>
              <Button
                size="small"
                type="text"
                disabled={keybindings.isDefault(def.id)}
                onClick={() => keybindings.resetBinding(def.id)}
              >
                {t.keybindingsReset}
              </Button>
              <SettingsSwitch
                checked={keybindings.enabledOf(def.id)}
                label={t[def.labelKey] as string}
                disabled={!keybindings.master}
                onChange={(value) => keybindings.setEnabled(def.id, value)}
              />
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title={t.keybindingsBuiltinGroup} hint={t.keybindingsBuiltinHint}>
        {builtinSections.map((section) => (
          <div key={section.group} className={styles.subGroup}>
            <div className={styles.subTitle}>{section.title}</div>
            <div className={styles.subRows}>
              {section.items.map((item) => (
                <div key={item.labelKey} className={styles.row}>
                  <span className={styles.label}>{t[item.labelKey] as string}</span>
                  <span className={`${styles.keys} ${styles.plain}`}>{item.keys}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}

export default KeybindingsSettings;
