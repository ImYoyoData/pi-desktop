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

describe("composerModePreamble plan naming", () => {
  it("requires dated descriptive plan paths for plan and task, not PLAN.md", () => {
    for (const mode of ["plan", "task"] as const) {
      const preamble = composerModePreamble(mode);
      expect(preamble).toContain("docs/superpowers/plans/");
      expect(preamble).toContain("YYYY-MM-DD-<short-kebab-topic>.md");
      expect(preamble).toMatch(/Do \*\*not\*\* default to `PLAN\.md`/);
    }
  });
});
