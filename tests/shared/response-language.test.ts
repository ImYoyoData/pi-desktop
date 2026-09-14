import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESPONSE_LANGUAGE_SETTINGS,
  RESPONSE_LANGUAGE_AUTO,
  RESPONSE_LANGUAGE_OPTIONS,
  isResponseLanguage,
  languageForDeviceTag,
  parseResponseLanguageSettings,
  resolveResponseLanguage,
} from "../../src/shared/response-language";
import { desktopResponseLanguagePrompt } from "../../src/shared/desktop-system-prompt";

/**
 * The answer language is a separate setting from the UI locale, and `auto` follows
 * the device. Getting the device mapping wrong would silently make Pi answer in
 * the wrong language, so the resolution rules are pinned here.
 */
describe("response language settings", () => {
  it("defaults to auto", () => {
    expect(DEFAULT_RESPONSE_LANGUAGE_SETTINGS.language).toBe(RESPONSE_LANGUAGE_AUTO);
    expect(parseResponseLanguageSettings(undefined).language).toBe(RESPONSE_LANGUAGE_AUTO);
  });

  it("accepts known languages and every offered option", () => {
    for (const option of RESPONSE_LANGUAGE_OPTIONS) {
      expect(isResponseLanguage(option.value)).toBe(true);
      expect(parseResponseLanguageSettings({ language: option.value }).language).toBe(option.value);
    }
  });

  it("falls back to auto for unknown, empty or corrupt values", () => {
    for (const bad of ["", "klingon", 42, null, {}, [], { language: 7 }]) {
      expect(parseResponseLanguageSettings({ language: bad }).language).toBe(RESPONSE_LANGUAGE_AUTO);
    }
    expect(parseResponseLanguageSettings("nope").language).toBe(RESPONSE_LANGUAGE_AUTO);
  });

  it("offers Simplified and Traditional Chinese separately", () => {
    const values = RESPONSE_LANGUAGE_OPTIONS.map((o) => o.value);
    expect(values).toContain("zh-CN");
    expect(values).toContain("zh-TW");
  });
});

describe("languageForDeviceTag", () => {
  it("maps Chinese variants precisely (Traditional must not collapse to Simplified)", () => {
    expect(languageForDeviceTag("zh-CN")).toBe("zh-CN");
    expect(languageForDeviceTag("zh-Hans-CN")).toBe("zh-CN");
    expect(languageForDeviceTag("zh-TW")).toBe("zh-TW");
    expect(languageForDeviceTag("zh-Hant-TW")).toBe("zh-TW");
    expect(languageForDeviceTag("zh-HK")).toBe("zh-TW");
  });

  it("maps common languages and ignores region/script suffixes", () => {
    expect(languageForDeviceTag("en-US")).toBe("en");
    expect(languageForDeviceTag("ja-JP")).toBe("ja");
    expect(languageForDeviceTag("pt-BR")).toBe("pt-BR");
    expect(languageForDeviceTag("pt-PT")).toBe("pt-BR");
    expect(languageForDeviceTag("de-AT")).toBe("de");
    expect(languageForDeviceTag("ko-KR")).toBe("ko");
  });

  it("normalises separators and case", () => {
    expect(languageForDeviceTag("ZH_tw")).toBe("zh-TW");
    expect(languageForDeviceTag("EN-us")).toBe("en");
  });

  it("passes an unknown device language through instead of guessing", () => {
    expect(languageForDeviceTag("sv-SE")).toBe("sv-se");
  });

  it("falls back to English when nothing is reported", () => {
    expect(languageForDeviceTag("")).toBe("en");
    expect(languageForDeviceTag(null)).toBe("en");
    expect(languageForDeviceTag(undefined)).toBe("en");
  });
});

describe("resolveResponseLanguage", () => {
  it("uses the device language only in auto mode", () => {
    expect(resolveResponseLanguage({ language: RESPONSE_LANGUAGE_AUTO }, "ja-JP")).toBe("ja");
    expect(resolveResponseLanguage({ language: "en" }, "ja-JP")).toBe("en");
    expect(resolveResponseLanguage({ language: "zh-TW" }, "en-US")).toBe("zh-TW");
  });

  it("never returns auto to the caller", () => {
    for (const tag of ["", "zh-CN", "en-GB"]) {
      expect(resolveResponseLanguage({ language: RESPONSE_LANGUAGE_AUTO }, tag)).not.toBe(
        RESPONSE_LANGUAGE_AUTO,
      );
    }
  });
});

describe("desktopResponseLanguagePrompt", () => {
  it("names the language and pins the code/prose boundary", () => {
    const prompt = desktopResponseLanguagePrompt("zh-CN");
    expect(prompt).toContain("zh-CN");
    expect(prompt).toContain("Response language");
    // Code and command output must not be translated.
    expect(prompt).toContain("shell commands");
  });

  it("emits nothing when the language could not be resolved", () => {
    expect(desktopResponseLanguagePrompt("")).toBe("");
    expect(desktopResponseLanguagePrompt("   ")).toBe("");
    expect(desktopResponseLanguagePrompt(RESPONSE_LANGUAGE_AUTO)).toBe("");
  });
});
