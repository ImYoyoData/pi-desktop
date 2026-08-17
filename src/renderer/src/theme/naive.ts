import type { GlobalThemeOverrides } from "naive-ui";

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif';
const fontFamilyMono =
  '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, "Liberation Mono", Menlo, Courier, monospace';

/** Light theme — DeepSeek Harness: white base, near-black text, DeepSeek blue. */
export const lightThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#4176e6",
    primaryColorHover: "#5686fe",
    primaryColorPressed: "#4176e6",
    primaryColorSuppl: "#679efe",
    successColor: "#22c55e",
    errorColor: "#ef4444",
    warningColor: "#f59e0b",
    infoColor: "#4176e6",
    borderRadius: "10px",
    borderRadiusSmall: "6px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#0f1115",
    textColor1: "#0f1115",
    textColor2: "#61666b",
    textColor3: "#81858c",
    bodyColor: "#ffffff",
    cardColor: "#ffffff",
    modalColor: "#ffffff",
    popoverColor: "#ffffff",
    tableColor: "#ffffff",
    inputColor: "#ffffff",
    actionColor: "#f1f3f5",
    hoverColor: "#f1f3f5",
    borderColor: "#e3e6ec",
    dividerColor: "#e3e6ec",
    boxShadow1: "0 1px 2px rgba(15, 17, 21, 0.04)",
    boxShadow2: "0 4px 18px rgba(15, 17, 21, 0.07)",
    boxShadow3: "0 12px 40px rgba(15, 17, 21, 0.1)",
  },
  Button: {
    fontWeight: "500",
    heightMedium: "32px",
    heightSmall: "28px",
    heightTiny: "22px",
  },
  Input: {
    borderHover: "1px solid #d5d9e1",
    borderFocus: "1px solid #4176e6",
    borderRadius: "9px",
  },
  Card: {
    borderColor: "#e3e6ec",
    borderRadius: "14px",
  },
  Tabs: {
    tabBorderRadius: "8px",
    tabFontWeightActive: "560",
  },
};

/** Dark theme — DeepSeek Harness dark: blue-tinted blacks, soft blue accent. */
export const darkThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: "#5686fe",
    primaryColorHover: "#679efe",
    primaryColorPressed: "#4176e6",
    primaryColorSuppl: "#9db4fe",
    successColor: "#4ed17e",
    errorColor: "#f25a5a",
    warningColor: "#f5a623",
    infoColor: "#5686fe",
    borderRadius: "10px",
    borderRadiusSmall: "6px",
    fontFamily,
    fontFamilyMono,
    fontSize: "13px",
    textColorBase: "#f5f6f7",
    textColor1: "#f9fafb",
    textColor2: "#cfd3d6",
    textColor3: "#adb2b8",
    bodyColor: "#151517",
    cardColor: "#1b1b1c",
    modalColor: "#1b1b1c",
    popoverColor: "#232324",
    tableColor: "#1b1b1c",
    inputColor: "#232324",
    actionColor: "#232324",
    hoverColor: "#2c2c2d",
    borderColor: "#2c2c2d",
    dividerColor: "#2c2c2d",
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
    borderHover: "1px solid #3a3a3b",
    borderFocus: "1px solid #5686fe",
    borderRadius: "9px",
  },
  Card: {
    borderColor: "#2c2c2d",
    borderRadius: "14px",
  },
  Tabs: {
    tabBorderRadius: "8px",
    tabFontWeightActive: "560",
  },
};

/** @deprecated use lightThemeOverrides */
export const themeOverrides = lightThemeOverrides;
