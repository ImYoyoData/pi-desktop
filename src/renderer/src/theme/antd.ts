import { theme, type MappingAlgorithm, type ThemeConfig } from "antd";
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
  /** 去掉弹窗遮罩：对话框直接浮在应用之上，不再压暗底层界面 */
  colorBgMask: "transparent",
};

/** 开启 CSS 变量模式：壁纸玻璃态靠覆盖 `--ant-color-*` 变量实现。 */
const cssVar = { prefix: "ant" };

/** 应用主色：与 main.css 里的 `--accent` 保持同色。 */
const LIGHT_PRIMARY = "#0069cc";
const DARK_PRIMARY = "#297aa0";

/**
 * antd 的算法会改写 colorPrimary（暗色下压成 #266b8b），
 * 而应用自绘控件用的是 --accent，同一屏里两种主色对不上。
 * 这里在算法结果上把主色钉死成与 --accent 相同的色值。
 * 包装结果必须是模块级常量：算法函数换了引用，antd 会重建整套样式缓存。
 */
function withPrimaryColor(
  algorithm: MappingAlgorithm,
  primary: string,
): MappingAlgorithm {
  return (token, derivativeToken) => ({
    ...algorithm(token, derivativeToken),
    colorPrimary: primary,
  });
}

const lightAlgorithm = withPrimaryColor(theme.defaultAlgorithm, LIGHT_PRIMARY);
const darkAlgorithm = withPrimaryColor(theme.darkAlgorithm, DARK_PRIMARY);

/** 浅色主题 — VS Code "2026 Light"。 */
export const lightThemeConfig: ThemeConfig = {
  algorithm: lightAlgorithm,
  cssVar,
  token: {
    ...sharedToken,
    colorPrimary: LIGHT_PRIMARY,
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
  algorithm: darkAlgorithm,
  cssVar,
  token: {
    ...sharedToken,
    colorPrimary: DARK_PRIMARY,
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

/**
 * 按字号生成主题配置：antd 内部字号是 px，不跟随根元素 font-size，
 * 需要把设置值透传给 token。缓存保证同一档位拿到同一个对象，避免重建样式。
 */
const themeCache = new Map<string, ThemeConfig>();

export function themeConfigFor(mode: ResolvedTheme, fontSize: number): ThemeConfig {
  const key = `${mode}:${fontSize}`;
  const cached = themeCache.get(key);
  if (cached) return cached;
  const base = mode === "dark" ? darkThemeConfig : lightThemeConfig;
  const config: ThemeConfig = {
    ...base,
    token: { ...base.token, fontSize },
  };
  themeCache.set(key, config);
  return config;
}

export function antdLocaleFor(locale: UiLocale): Locale {
  return locale === "zh-CN" ? zhCN : enUS;
}
