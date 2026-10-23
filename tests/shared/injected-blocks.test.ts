import { describe, expect, it } from "vitest";
import {
  isLegacyModeTagKind,
  stripInjectedBlocks,
} from "../../src/shared/injected-blocks";

describe("stripInjectedBlocks", () => {
  it("removes the legacy mode block and keeps the user text", () => {
    const full = "[pi-desktop mode: agent]\nYou are in **Agent mode**.\n\nhello world";
    expect(stripInjectedBlocks(full)).toBe("hello world");
  });

  it("leaves normal user text alone", () => {
    expect(stripInjectedBlocks("just a question")).toBe("just a question");
  });

  it("returns empty when only the legacy mode block is present", () => {
    expect(stripInjectedBlocks("[pi-desktop mode: ask]\nrule")).toBe("");
  });

  it("removes the thinking language block", () => {
    const full = "<reasoning-language>\n用中文思考\n</reasoning-language>\n\n正文";
    expect(stripInjectedBlocks(full)).toBe("正文");
  });
});

describe("isLegacyModeTagKind", () => {
  it("matches the retired mode kinds only", () => {
    expect(isLegacyModeTagKind("agent")).toBe(true);
    expect(isLegacyModeTagKind("ask")).toBe(true);
    expect(isLegacyModeTagKind("plan")).toBe(true);
    expect(isLegacyModeTagKind("task")).toBe(true);
    expect(isLegacyModeTagKind("file")).toBe(false);
    expect(isLegacyModeTagKind(undefined)).toBe(false);
  });
});
