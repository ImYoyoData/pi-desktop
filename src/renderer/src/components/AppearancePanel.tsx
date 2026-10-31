import { useEffect, type ReactNode } from "react";
import { Select } from "antd";
import {
  useAppearanceStore,
  type LocalePreference,
  type ThemePreference,
} from "@renderer/stores/appearance";
import { useStreamRenderStore } from "@renderer/stores/stream-render";
import { STREAM_RENDER_THROTTLE_CHOICES } from "../../../shared/stream-render";
import { FONT_SIZE_CHOICES, MESSAGE_WIDTH_CHOICES, BUILTIN_FONTS } from "../../../shared/appearance";
import AppearanceWallpaperCard from "@renderer/components/customize/AppearanceWallpaperCard";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSwitch,
} from "@renderer/components/customize/SettingsGroup";
import { isUiLocale } from "@renderer/i18n";
import { useI18n } from "@renderer/i18n/use-i18n";
import styles from "./AppearancePanel.module.css";

type Option = { label: string; value: number };

export function AppearancePanel(): ReactNode {
  const t = useI18n();
  const appearance = useAppearanceStore();
  const streamRender = useStreamRenderStore();

  useEffect(() => {
    void streamRender.load();
  }, []);

  /** 切换语言：原地替换界面文案，不刷页、不显示加载页。 */
  function onLocaleUpdate(value: string | number | null): void {
    if (value !== "system" && !isUiLocale(value)) return;
    if (value === appearance.localePreference) return;
    appearance.setLocalePreference(value as LocalePreference);
  }

  function onStreamRenderThrottleChange(value: string | number | null): void {
    if (typeof value === "number") void streamRender.update({ throttleMs: value });
  }

  function onMessageWidthChange(value: string | number | null): void {
    if (typeof value === "number") appearance.setMessageWidth(value);
  }

  function onInputWidthChange(value: string | number | null): void {
    if (typeof value === "number") appearance.setInputWidth(value);
  }

  function onFontSizeChange(value: string | number | null): void {
    if (typeof value === "number") appearance.setFontSize(value);
  }

  /** 选择本地字体文件后直接套用到对应的字体设置。 */
  async function addLocalFont(apply: (id: string) => void): Promise<void> {
    const path = await window.api.appearance.pickFontFile();
    if (!path) return;
    const entry = appearance.addLocalFont(path);
    if (entry) apply(entry.id);
  }

  const fontOptions = [
    { value: "", label: t.appearanceFontDefault },
    ...BUILTIN_FONTS.map((font) => ({ value: font.id, label: font.label })),
    ...appearance.fonts.local.map((font) => ({ value: font.id, label: font.name })),
  ];

  const isLocalFont = (id: string): boolean => id.startsWith("local:");

  const messageWidthOptions: Option[] = MESSAGE_WIDTH_CHOICES.map((value) => ({
    label: t.appearanceMessageWidthValue(Math.round(value * 100)),
    value,
  }));

  const fontSizeOptions: Option[] = FONT_SIZE_CHOICES.map((value) => ({
    label: t.appearanceFontSizeValue(value),
    value,
  }));

  const streamRenderThrottleOptions: Option[] = STREAM_RENDER_THROTTLE_CHOICES.map((ms) => ({
    label: t.streamRenderThrottleValue(ms),
    value: ms,
  }));

  const themeOptions = [
    { label: t.themeSystem, value: "system" },
    { label: t.themeLight, value: "light" },
    { label: t.themeDark, value: "dark" },
  ];

  const localeOptions = [
    { label: t.themeSystem, value: "system" },
    { label: "中文（简体）", value: "zh-CN" },
    { label: "中文（繁體）", value: "zh-TW" },
    { label: "日本語", value: "ja" },
    { label: "English", value: "en" },
  ];

  return (
    <div className={styles.appearancePanel}>
      <AppearanceWallpaperCard />

      <SettingsGroup>
        <SettingsRow label={t.theme}>
          <Select
            value={appearance.themePreference}
            options={themeOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value) =>
              appearance.setThemePreference(value as ThemePreference)
            }
          />
        </SettingsRow>

        <SettingsRow label={t.language}>
          <Select
            value={appearance.localePreference}
            options={localeOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value) => onLocaleUpdate(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.appearanceFontSize} description={t.appearanceFontSizeTip}>
          <Select
            value={appearance.fontSize}
            options={fontSizeOptions}
            size="small"
            className={styles.settingSelect}
            onChange={(value) => onFontSizeChange(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.appearanceUiFont}>
          <div className={styles.fontControl}>
            <Select
              value={appearance.fonts.ui}
              options={fontOptions}
              size="small"
              className={styles.fontSelect}
              popupMatchSelectWidth={false}
              onChange={(value) => appearance.setUiFont(value)}
            />
            <button
              type="button"
              className={styles.fontAction}
              title={t.appearanceFontAdd}
              onClick={() => void addLocalFont(appearance.setUiFont)}
            >
              +
            </button>
            {isLocalFont(appearance.fonts.ui) ? (
              <button
                type="button"
                className={styles.fontAction}
                title={t.appearanceFontRemove}
                onClick={() => appearance.removeLocalFont(appearance.fonts.ui)}
              >
                ×
              </button>
            ) : null}
          </div>
        </SettingsRow>

        <SettingsRow label={t.appearanceMonoFont}>
          <div className={styles.fontControl}>
            <Select
              value={appearance.fonts.mono}
              options={fontOptions}
              size="small"
              className={styles.fontSelect}
              popupMatchSelectWidth={false}
              onChange={(value) => appearance.setMonoFont(value)}
            />
            <button
              type="button"
              className={styles.fontAction}
              title={t.appearanceFontAdd}
              onClick={() => void addLocalFont(appearance.setMonoFont)}
            >
              +
            </button>
            {isLocalFont(appearance.fonts.mono) ? (
              <button
                type="button"
                className={styles.fontAction}
                title={t.appearanceFontRemove}
                onClick={() => appearance.removeLocalFont(appearance.fonts.mono)}
              >
                ×
              </button>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t.appearanceInterface}>
        <SettingsRow label={t.showSessionTitle}>
          <SettingsSwitch
            checked={appearance.showSessionTitle}
            label={t.showSessionTitle}
            onChange={(value) => appearance.setShowSessionTitle(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.showCompactButton}>
          <SettingsSwitch
            checked={appearance.showCompactButton}
            label={t.showCompactButton}
            onChange={(value) => appearance.setShowCompactButton(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.streamRenderThrottle}>
          <Select
            value={streamRender.throttleMs}
            options={streamRenderThrottleOptions}
            size="small"
            className={styles.settingSelect}
            onChange={onStreamRenderThrottleChange}
          />
        </SettingsRow>

        <SettingsRow label={t.appearanceMessageWidth}>
          <Select
            value={appearance.messageWidth}
            options={messageWidthOptions}
            size="small"
            className={styles.settingSelect}
            onChange={onMessageWidthChange}
          />
        </SettingsRow>

        <SettingsRow label={t.appearanceInputWidth} description={t.appearanceInputWidthTip}>
          <Select
            value={appearance.inputWidth}
            options={messageWidthOptions}
            size="small"
            className={styles.settingSelect}
            onChange={onInputWidthChange}
          />
        </SettingsRow>

        <SettingsRow label={t.showSessionDetails}>
          <SettingsSwitch
            checked={appearance.showSessionDetails}
            label={t.showSessionDetails}
            onChange={(value) => appearance.setShowSessionDetails(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.expandToolCalls}>
          <SettingsSwitch
            checked={appearance.expandToolCalls}
            label={t.expandToolCalls}
            onChange={(value) => appearance.setExpandToolCalls(value)}
          />
        </SettingsRow>

        <SettingsRow label={t.autoExpandSummary}>
          <SettingsSwitch
            checked={appearance.autoExpandSummary}
            label={t.autoExpandSummary}
            onChange={(value) => appearance.setAutoExpandSummary(value)}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

export default AppearancePanel;
