import type { GlobalThemeOverrides } from "naive-ui";

/** Light theme aligned with Cursor / pi-web Agents Window */
export const themeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#2563eb",
    primaryColorHover: "#1d4ed8",
    primaryColorPressed: "#1e40af",
    primaryColorSuppl: "#3b82f6",
    successColor: "#16a34a",
    errorColor: "#dc2626",
    warningColor: "#ca8a04",
    infoColor: "#2563eb",
    borderRadius: "8px",
    borderRadiusSmall: "6px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans SC", system-ui, sans-serif',
    fontFamilyMono: '"SF Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
    fontSize: "13px",
    textColorBase: "#1a1a1a",
    textColor1: "#1a1a1a",
    textColor2: "#6b7280",
    textColor3: "#9ca3af",
    bodyColor: "#ffffff",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    tableColor: "#ffffff",
    inputColor: "#ffffff",
    actionColor: "#f5f5f5",
    hoverColor: "#eeeeee",
    borderColor: "#e0e0e0",
    dividerColor: "#e0e0e0",
  },
  Button: {
    fontWeight: "500",
  },
  Input: {
    borderHover: "1px solid #d0d0d0",
    borderFocus: "1px solid #2563eb",
  },
  Card: {
    borderColor: "#e0e0e0",
  },
};
