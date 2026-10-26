import { useState, type ReactNode } from "react";
import { Select } from "antd";
import {
  BROWSER_TOOL_MODES,
  browserPrefsPatch,
  parseBrowserSettings,
  type BrowserSettings,
} from "../../../../shared/browser-settings";
import { SettingsGroup, SettingsRow } from "@renderer/components/customize/SettingsGroup";
import { useI18n } from "@renderer/i18n/use-i18n";
import * as prefs from "@renderer/utils/prefs";
import styles from "./CustomizeBrowser.module.css";

/** 内置浏览器设置存在 desktop-prefs.json，与 worker 共用同一份键。 */
function readBrowserSettings(): BrowserSettings {
  const map: Record<string, string> = {};
  for (const key of prefs.keys()) {
    const value = prefs.getItem(key);
    if (value !== null) map[key] = value;
  }
  return parseBrowserSettings(map);
}

export function CustomizeBrowser(): ReactNode {
  const t = useI18n();
  const [settings, setSettings] = useState<BrowserSettings>(readBrowserSettings);

  function save(patch: Partial<BrowserSettings>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    for (const [key, value] of Object.entries(browserPrefsPatch(next))) {
      prefs.setItem(key, value);
    }
  }

  const modeOptions = BROWSER_TOOL_MODES.map((mode) => ({
    value: mode,
    label: t.browserToolMode(mode),
  }));

  return (
    <div className={styles.root}>
      <SettingsGroup>
        <SettingsRow label={t.browserToolsMode}>
          <Select
            className={styles.settingSelect}
            size="small"
            value={settings.toolMode}
            options={modeOptions}
            onChange={(mode: BrowserSettings["toolMode"]) => save({ toolMode: mode })}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default CustomizeBrowser;
