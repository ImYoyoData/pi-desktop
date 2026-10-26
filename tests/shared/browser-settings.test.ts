import { describe, expect, it } from "vitest";
import {
  BROWSER_RECORD_HISTORY_PREF,
  BROWSER_TOOL_MODE_PREF,
  DEFAULT_BROWSER_SETTINGS,
  browserPrefsPatch,
  normalizeNewTabUrl,
  parseBrowserSettings,
} from "../../src/shared/browser-settings";

describe("parseBrowserSettings", () => {
  it("prefs 为空时回落到默认值", () => {
    expect(parseBrowserSettings({})).toEqual(DEFAULT_BROWSER_SETTINGS);
  });

  it("只接受三种工具模式，非法值回落 auto", () => {
    expect(parseBrowserSettings({ [BROWSER_TOOL_MODE_PREF]: "always" }).toolMode).toBe("always");
    expect(parseBrowserSettings({ [BROWSER_TOOL_MODE_PREF]: "off" }).toolMode).toBe("off");
    expect(parseBrowserSettings({ [BROWSER_TOOL_MODE_PREF]: "nope" }).toolMode).toBe("auto");
  });

  it("历史开关只认显式 false", () => {
    expect(parseBrowserSettings({ [BROWSER_RECORD_HISTORY_PREF]: "false" }).recordHistory).toBe(
      false,
    );
    expect(parseBrowserSettings({ [BROWSER_RECORD_HISTORY_PREF]: "true" }).recordHistory).toBe(
      true,
    );
  });
});

describe("normalizeNewTabUrl", () => {
  it("保留 http(s) 地址并去掉首尾空白", () => {
    expect(normalizeNewTabUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("其余输入回落空白页", () => {
    expect(normalizeNewTabUrl("example.com")).toBe("");
    expect(normalizeNewTabUrl("file:///c:/x")).toBe("");
    expect(normalizeNewTabUrl(null)).toBe("");
  });
});

describe("browserPrefsPatch", () => {
  it("可与 parseBrowserSettings 往返", () => {
    const settings = { toolMode: "off" as const, newTabUrl: "https://a.dev", recordHistory: false };
    expect(parseBrowserSettings(browserPrefsPatch(settings))).toEqual(settings);
  });
});
