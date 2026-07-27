import type { GlobalThemeOverrides } from "naive-ui";

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif';
const fontFamilyMono = '"SF Mono", "Cascadia Code", Consolas, ui-monospace, monospace';

/** Light theme — refined zinc + blue accent */
export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#2563eb",
    primaryColorHover: "#1d4ed8",
    primaryColorPressed: "#1e40af",
    primaryColorSuppl: "#3b82f6",
    successColor: "#16a34a",
    errorColor: "#dc2626",
    warningColor: "#ca8a04",
    infoColor: "#2563eb",
    borderRadius: "11px",
    borderRadiusSmall: "7px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#18181b",
    textColor1: "#09090b",
    textColor2: "#71717a",
    textColor3: "#a1a1aa",
    bodyColor: "#f7f7f8",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    tableColor: "#ffffff",
    inputColor: "#ffffff",
    actionColor: "#f0f0f2",
    hoverColor: "#e8e8ec",
    borderColor: "#e6e6ea",
    dividerColor: "#e6e6ea",
    boxShadow1: "0 1px 2px rgba(15, 23, 42, 0.04)",
    boxShadow2: "0 4px 18px rgba(15, 23, 42, 0.07)",
    boxShadow3: "0 12px 40px rgba(15, 23, 42, 0.1)",
  },
  Button: {
    fontWeight: "500",
    heightMedium: "32px",
    heightSmall: "28px",
    heightTiny: "22px",
  },
  Input: {
    borderHover: "1px solid #d2d2d8",
    borderFocus: "1px solid #2563eb",
    borderRadius: "9px",
  },
  Card: {
    borderColor: "#e6e6ea",
    borderRadius: "14px",
  },
  Tabs: {
    tabBorderRadius: "8px",
    tabFontWeightActive: "560",
  },
};

/** Dark theme — deep zinc with restrained blue */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#3b82f6",
    primaryColorHover: "#60a5fa",
    primaryColorPressed: "#2563eb",
    primaryColorSuppl: "#93c5fd",
    successColor: "#22c55e",
    errorColor: "#f87171",
    warningColor: "#fbbf24",
    infoColor: "#60a5fa",
    borderRadius: "11px",
    borderRadiusSmall: "7px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#e4e4e7",
    textColor1: "#fafafa",
    textColor2: "#a1a1aa",
    textColor3: "#71717a",
    bodyColor: "#0b0b0e",
    cardColor: "#141418",
    modalColor: "#141418",
    popoverColor: "#1c1c22",
    tableColor: "#141418",
    inputColor: "#1c1c22",
    actionColor: "#1c1c22",
    hoverColor: "#25252c",
    borderColor: "#2a2a32",
    dividerColor: "#2a2a32",
    boxShadow1: "0 1px 2px rgba(0, 0, 0, 0.35)",
    boxShadow2: "0 8px 28px rgba(0, 0, 0, 0.45)",
    boxShadow3: "0 16px 48px rgba(0, 0, 0, 0.55)",
  },
  Button: {
    fontWeight: "500",
    heightMedium: "32px",
    heightSmall: "28px",
    heightTiny: "22px",
  },
  Input: {
    borderHover: "1px solid #3a3a44",
    borderFocus: "1px solid #3b82f6",
    borderRadius: "9px",
  },
  Card: {
    borderColor: "#2a2a32",
    borderRadius: "14px",
  },
  Tabs: {
    tabBorderRadius: "8px",
    tabFontWeightActive: "560",
  },
};

/** @deprecated use lightThemeOverrides */
export const themeOverrides = lightThemeOverrides;
