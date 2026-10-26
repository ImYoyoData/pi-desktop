import { describe, expect, it } from "vitest";
import {
  BROWSER_TOOL_MODE_PREF,
  DEFAULT_BROWSER_SETTINGS,
  browserPrefsPatch,
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
});

describe("browserPrefsPatch", () => {
  it("可与 parseBrowserSettings 往返", () => {
    const settings = { toolMode: "off" as const };
    expect(parseBrowserSettings(browserPrefsPatch(settings))).toEqual(settings);
  });
});
