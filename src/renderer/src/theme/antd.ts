import { theme, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import type { Locale } from "antd/es/locale";
import type { UiLocale } from "@renderer/i18n";

export type ResolvedTheme = "light" | "dark";

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
const fontFamilyMono =
  'Consolas, "Courier New", Menlo, Monaco, "SF Mono", "JetBrains Mono", "Fira Code", "PingFang SC", "Microsoft YaHei", monospace';

const sharedToken = {
  borderRadius: 4,
  fontSize: 13,
  fontFamily,
  fontFamilyCode: fontFamilyMono,
  controlHeight: 32,
};

/** 开启 CSS 变量模式：壁纸玻璃态靠覆盖 `--ant-color-*` 变量实现。 */
const cssVar = { prefix: "ant" };

/** 浅色主题 — VS Code "2026 Light"。 */
export const lightThemeConfig: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  cssVar,
  token: {
    ...sharedToken,
    colorPrimary: "#0069cc",
    colorText: "#202020",
    colorTextSecondary: "#606060",
    colorTextTertiary: "#999999",
    colorBgBase: "#ffffff",
    colorBgLayout: "#ffffff",
    colorBgContainer: "#fafafd",
    colorBgElevated: "#fafafd",
    colorBorder: "#f0f1f2",
    colorBorderSecondary: "#f0f1f2",
    colorFillSecondary: "#f7f7fa",
  },
};

/** 深色主题 — VS Code "2026 Dark"。 */
export const darkThemeConfig: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  cssVar,
  token: {
    ...sharedToken,
    colorPrimary: "#297aa0",
    colorText: "#f5f6f7",
    colorTextSecondary: "#cfd3d6",
    colorTextTertiary: "#adb2b8",
    colorBgBase: "#121314",
    colorBgLayout: "#121314",
    colorBgContainer: "#202122",
    colorBgElevated: "#202122",
    colorBorder: "#2a2b2c",
    colorBorderSecondary: "#2a2b2c",
    colorFillSecondary: "#202122",
  },
};

export function themeConfigFor(mode: ResolvedTheme): ThemeConfig {
  return mode === "dark" ? darkThemeConfig : lightThemeConfig;
}

export function antdLocaleFor(locale: UiLocale): Locale {
  return locale === "zh-CN" ? zhCN : enUS;
}
