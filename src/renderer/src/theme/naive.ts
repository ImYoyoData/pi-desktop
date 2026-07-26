import type { GlobalThemeOverrides } from "naive-ui";

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif';
const fontFamilyMono = '"SF Mono", "Cascadia Code", Consolas, ui-monospace, monospace';

/** Light theme aligned with Cursor / pi-web Agents Window */
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
    borderRadius: "10px",
    borderRadiusSmall: "6px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#18181b",
    textColor1: "#09090b",
    textColor2: "#71717a",
    textColor3: "#a1a1aa",
    bodyColor: "#fafafa",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    tableColor: "#ffffff",
    inputColor: "#ffffff",
    actionColor: "#f4f4f5",
    hoverColor: "#ececef",
    borderColor: "#e4e4e7",
    dividerColor: "#e4e4e7",
  },
  Button: {
    fontWeight: "500",
  },
  Input: {
    borderHover: "1px solid #d4d4d8",
    borderFocus: "1px solid #2563eb",
  },
  Card: {
    borderColor: "#e4e4e7",
  },
};

/** Dark theme — zinc/slate with blue accent (pi-web-like) */
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
    borderRadius: "10px",
    borderRadiusSmall: "6px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#e4e4e7",
    textColor1: "#fafafa",
    textColor2: "#a1a1aa",
    textColor3: "#71717a",
    bodyColor: "#09090b",
    cardColor: "#18181b",
    modalColor: "#18181b",
    popoverColor: "#18181b",
    tableColor: "#18181b",
    inputColor: "#27272a",
    actionColor: "#27272a",
    hoverColor: "#27272a",
    borderColor: "#3f3f46",
    dividerColor: "#3f3f46",
  },
  Button: {
    fontWeight: "500",
  },
  Input: {
    borderHover: "1px solid #52525b",
    borderFocus: "1px solid #3b82f6",
  },
  Card: {
    borderColor: "#3f3f46",
  },
};

/** @deprecated use lightThemeOverrides */
export const themeOverrides = lightThemeOverrides;
