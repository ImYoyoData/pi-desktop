import type { GlobalThemeOverrides } from "naive-ui";

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
const fontFamilyMono =
  'Consolas, "Courier New", Menlo, Monaco, "SF Mono", "JetBrains Mono", "Fira Code", "PingFang SC", "Microsoft YaHei", monospace';

/** Light theme — VS Code "2026 Light" (extensions/theme-defaults/themes/2026-light.json). */
export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#0069cc",
    primaryColorHover: "#0063c1",
    primaryColorPressed: "#005cb3",
    primaryColorSuppl: "#0069cc",
    successColor: "#587c0c",
    errorColor: "#ad0707",
    warningColor: "#bf8803",
    infoColor: "#0069cc",
    borderRadius: "4px",
    borderRadiusSmall: "2px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#202020",
    textColor1: "#202020",
    textColor2: "#606060",
    textColor3: "#999999",
    bodyColor: "#ffffff",
    cardColor: "#fafafd",
    modalColor: "#fafafd",
    popoverColor: "#fafafd",
    tableColor: "#ffffff",
    inputColor: "#f7f7fa",
    actionColor: "#00000014",
    hoverColor: "#00000014",
    borderColor: "#f0f1f2",
    dividerColor: "#f0f1f2",
    boxShadow1: "0 0 8px 2px rgba(0, 0, 0, 0.12)",
    boxShadow2: "0 0 8px 2px rgba(0, 0, 0, 0.14)",
    boxShadow3: "0 0 8px 2px rgba(0, 0, 0, 0.16)",
  },
  Button: {
    fontWeight: "500",
    heightMedium: "32px",
    heightSmall: "28px",
    heightTiny: "22px",
  },
  Input: {
    borderHover: "1px solid #d8d8d8",
    borderFocus: "1px solid #0069cc",
    borderRadius: "4px",
  },
  Card: {
    borderColor: "#e4e5e6",
    borderRadius: "8px",
  },
  Tabs: {
    tabBorderRadius: "4px",
    tabFontWeightActive: "600",
  },
};

/** Dark theme — VS Code "2026 Dark" (extensions/theme-defaults/themes/2026-dark.json). */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#297aa0",
    primaryColorHover: "#2b7da3",
    primaryColorPressed: "#246a8c",
    primaryColorSuppl: "#297aa0",
    successColor: "#72c892",
    errorColor: "#f48771",
    warningColor: "#cca700",
    infoColor: "#297aa0",
    borderRadius: "4px",
    borderRadiusSmall: "2px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#f5f6f7",
    textColor1: "#f9fafb",
    textColor2: "#cfd3d6",
    textColor3: "#adb2b8",
    bodyColor: "#121314",
    cardColor: "#202122",
    modalColor: "#202122",
    popoverColor: "#202122",
    tableColor: "#121314",
    inputColor: "#202122",
    actionColor: "#ffffff14",
    hoverColor: "#ffffff14",
    borderColor: "#2a2b2c",
    dividerColor: "#2a2b2c",
    boxShadow1: "0 0 8px 2px rgba(0, 0, 0, 0.36)",
    boxShadow2: "0 4px 16px rgba(0, 0, 0, 0.44)",
    boxShadow3: "0 8px 32px rgba(0, 0, 0, 0.52)",
  },
  Button: {
    fontWeight: "500",
    heightMedium: "32px",
    heightSmall: "28px",
    heightTiny: "22px",
  },
  Input: {
    borderHover: "1px solid #333536",
    borderFocus: "1px solid #3994bcb3",
    borderRadius: "4px",
  },
  Card: {
    borderColor: "#2a2b2c",
    borderRadius: "8px",
  },
  Tabs: {
    tabBorderRadius: "4px",
    tabFontWeightActive: "600",
  },
};

/** @deprecated use lightThemeOverrides */
export const themeOverrides = lightThemeOverrides;
