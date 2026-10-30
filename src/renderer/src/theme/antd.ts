import { theme, type MappingAlgorithm, type ThemeConfig } from "antd";
import zhCN from "antd/locale/zh_CN";
import zhTW from "antd/locale/zh_TW";
import jaJP from "antd/locale/ja_JP";
import enUS from "antd/locale/en_US";
import type { Locale } from "antd/es/locale";
import type { UiLocale } from "@renderer/i18n";

export type ResolvedTheme = "light" | "dark";

// 字体栈由 appearance store 写到根变量，antd 组件跟随同一份设置。
const fontFamily = "var(--font-ui)";
const fontFamilyMono = "var(--font-mono)";

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

/** 应用主色：中性强调，深色主题为白、浅色主题为近黑；与 main.css 里的 `--accent` 保持同色。 */
const LIGHT_PRIMARY = "#202020";
const DARK_PRIMARY = "#f5f6f7";

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

/**
 * 下拉与右键菜单统一胶囊外观：容器大圆角 + 条目圆角并留出内边距。
 * Dropdown 的容器圆角与内边距走 Dropdown token，条目走 Menu token。
 */
const sharedComponents: NonNullable<ThemeConfig["components"]> = {
  Dropdown: {
    borderRadiusLG: 12,
    paddingBlock: 4,
    controlPaddingHorizontal: 4,
  },
  Menu: {
    itemBorderRadius: 8,
    subMenuItemBorderRadius: 8,
    itemHeight: 30,
    itemMarginBlock: 1,
    itemMarginInline: 2,
    itemPaddingInline: 8,
  },
  Select: {
    borderRadiusLG: 12,
  },
};

/** 浅色主题 — VS Code "2026 Light"。 */
export const lightThemeConfig: ThemeConfig = {
  algorithm: lightAlgorithm,
  cssVar,
  components: sharedComponents,
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
    colorBorder: "#dcdee2",
    colorBorderSecondary: "#e8e9ec",
    colorFillSecondary: "#f7f7fa",
  },
};

/** 深色主题下强调色是白，实心强调上的文字必须反过来用深色。 */
const darkSolidComponents: NonNullable<ThemeConfig["components"]> = {
  ...sharedComponents,
  Button: { primaryColor: "#121314" },
  Radio: { buttonSolidCheckedColor: "#121314" },
};

/** 深色主题 — VS Code "2026 Dark"。 */
export const darkThemeConfig: ThemeConfig = {
  algorithm: darkAlgorithm,
  cssVar,
  components: darkSolidComponents,
  token: {
    ...sharedToken,
    colorPrimary: DARK_PRIMARY,
    colorText: "#f5f6f7",
    colorTextSecondary: "#cfd3d6",
    colorTextTertiary: "#adb2b8",
    colorBgBase: "#191a1b",
    colorBgLayout: "#191a1b",
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

const ANTD_LOCALES: Record<UiLocale, Locale> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja: jaJP,
  en: enUS,
};

export function antdLocaleFor(locale: UiLocale): Locale {
  return ANTD_LOCALES[locale];
}
