import { useState, type ReactNode } from "react";
import { Button, Input, Select } from "antd";
import {
  BROWSER_TOOL_MODES,
  browserPrefsPatch,
  normalizeNewTabUrl,
  parseBrowserSettings,
  type BrowserSettings,
} from "../../../../shared/browser-settings";
import { clearAllBookmarks, clearAllHistory } from "@renderer/stores/browser-library";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import { useDialog, useMessage } from "@renderer/services/feedback";
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
  const message = useMessage();
  const dialog = useDialog();
  const [settings, setSettings] = useState<BrowserSettings>(readBrowserSettings);
  const [urlDraft, setUrlDraft] = useState(() => settings.newTabUrl);

  function save(patch: Partial<BrowserSettings>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    for (const [key, value] of Object.entries(browserPrefsPatch(next))) {
      prefs.setItem(key, value);
    }
  }

  /** 失焦/回车才落盘，避免边输入边改默认地址。 */
  function commitUrl(): void {
    const next = normalizeNewTabUrl(urlDraft);
    if (urlDraft.trim() && !next) {
      message.warning(t.browserNewTabUrlInvalid);
      setUrlDraft(settings.newTabUrl);
      return;
    }
    setUrlDraft(next);
    if (next !== settings.newTabUrl) save({ newTabUrl: next });
  }

  function confirmClear(kind: "history" | "bookmarks"): void {
    dialog.create({
      title: kind === "history" ? t.browserClearHistory : t.browserClearBookmarks,
      content:
        kind === "history" ? t.browserClearHistoryConfirm : t.browserClearBookmarksConfirm,
      positiveText: t.browserClear,
      negativeText: t.cancel,
      onPositiveClick: () => {
        if (kind === "history") clearAllHistory();
        else clearAllBookmarks();
        message.success(t.browserCleared);
      },
    });
  }

  const modeOptions = BROWSER_TOOL_MODES.map((mode) => ({
    value: mode,
    label: t.browserToolMode(mode),
  }));

  return (
    <div className={styles.root}>
      <SettingsGroup title={t.browserToolsSection} hint={t.browserToolsSectionHint}>
        <SettingsRow label={t.browserToolsMode} description={t.browserToolsModeHint}>
          <Select
            className={styles.settingSelect}
            size="small"
            value={settings.toolMode}
            options={modeOptions}
            onChange={(mode: BrowserSettings["toolMode"]) => save({ toolMode: mode })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.browserBehaviorSection}>
        <SettingsRow label={t.browserNewTabUrl} description={t.browserNewTabUrlHint}>
          <Input
            className={styles.urlInput}
            size="small"
            allowClear
            value={urlDraft}
            placeholder="https://"
            onChange={(event) => setUrlDraft(event.target.value)}
            onBlur={commitUrl}
            onPressEnter={commitUrl}
          />
        </SettingsRow>
        <SettingsRow label={t.browserRecordHistory} description={t.browserRecordHistoryHint}>
          <SettingsSwitch
            checked={settings.recordHistory}
            label={t.browserRecordHistory}
            onChange={(value) => save({ recordHistory: value })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.browserDataSection} hint={t.browserDataSectionHint}>
        <SettingsRow label={t.browserClearHistory} description={t.browserClearHistoryHint}>
          <Button size="small" onClick={() => confirmClear("history")}>
            {t.browserClear}
          </Button>
        </SettingsRow>
        <SettingsRow label={t.browserClearBookmarks} description={t.browserClearBookmarksHint}>
          <Button size="small" onClick={() => confirmClear("bookmarks")}>
            {t.browserClear}
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default CustomizeBrowser;
