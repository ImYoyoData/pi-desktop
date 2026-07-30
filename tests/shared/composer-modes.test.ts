import { describe, expect, it } from "vitest";
import {
  composerModePreamble,
  stripComposerModePreamble,
} from "../../src/shared/composer-modes";

describe("stripComposerModePreamble", () => {
  it("removes injected mode block and keeps user text", () => {
    const full = `${composerModePreamble("agent")}\n\nhello world`;
    expect(stripComposerModePreamble(full)).toBe("hello world");
  });

  it("leaves normal user text alone", () => {
    expect(stripComposerModePreamble("just a question")).toBe("just a question");
  });

  it("returns empty when only the preamble is present", () => {
    expect(stripComposerModePreamble(composerModePreamble("ask"))).toBe("");
  });
});
