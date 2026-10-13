import { describe, expect, it } from "vitest";
import {
  agentTextFor,
  displayTextFor,
  planComposerTags,
  queueItemHasContent,
  queueMessageText,
  steerTextWithCitations,
  titleSeedFor,
  type ComposerTag,
} from "../../src/renderer/src/utils/composer-payload";

const tag = (partial: Partial<ComposerTag> & { url: string }): ComposerTag => ({
  ...partial,
});

describe("planComposerTags", () => {
  it("returns nothing for missing or empty tags", () => {
    expect(planComposerTags(undefined)).toEqual([]);
    expect(planComposerTags([])).toEqual([]);
  });

  it("routes agent-mode markers to the mode action first", () => {
    const out = planComposerTags([tag({ url: "x", kind: "agent" })]);
    expect(out).toEqual([{ kind: "mode", mode: "agent" }]);
    for (const mode of ["ask", "plan", "task"]) {
      expect(planComposerTags([tag({ url: "x", kind: mode })])[0]).toEqual({
        kind: "mode",
        mode,
      });
    }
  });

  it("maps file tags with content, label, then url fallback", () => {
    expect(planComposerTags([tag({ url: "u", kind: "file", content: "c", label: "l" })]))
      .toEqual([{ kind: "file", value: "c" }]);
    expect(planComposerTags([tag({ url: "u", kind: "file", label: "l" })]))
      .toEqual([{ kind: "file", value: "l" }]);
    expect(planComposerTags([tag({ url: "u", kind: "file" })]))
      .toEqual([{ kind: "file", value: "u" }]);
  });

  it("maps explicit url tags and unmarked http(s) urls", () => {
    expect(planComposerTags([tag({ url: "https://a.dev", kind: "url" })]))
      .toEqual([{ kind: "url", value: "https://a.dev" }]);
    expect(planComposerTags([tag({ url: "http://a.dev" })]))
      .toEqual([{ kind: "url", value: "http://a.dev" }]);
  });

  it("does not treat a non-http unmarked url as a url tag", () => {
    expect(planComposerTags([tag({ url: "ftp://a.dev" })]))
      .toEqual([{ kind: "citation", url: "ftp://a.dev", text: "" }]);
  });

  it("falls back to a citation for element and unknown kinds", () => {
    expect(planComposerTags([tag({ url: "u", kind: "element", content: "c" })]))
      .toEqual([{ kind: "citation", url: "u", text: "c" }]);
    expect(planComposerTags([tag({ url: "u", label: "l" })]))
      .toEqual([{ kind: "citation", url: "u", text: "l" }]);
  });

  it("keeps order across a mixed batch", () => {
    const out = planComposerTags([
      tag({ url: "m", kind: "agent" }),
      tag({ url: "f", kind: "file", content: "c" }),
      tag({ url: "https://a.dev" }),
      tag({ url: "e", kind: "element" }),
    ]);
    expect(out.map((a) => a.kind)).toEqual(["mode", "file", "url", "citation"]);
  });
});

describe("queueMessageText", () => {
  it("prefers the display text", () => {
    expect(queueMessageText({ displayText: "hi", text: "agent hi", hasVisual: false })).toBe("hi");
  });

  it("uses a space placeholder for visual-only payloads", () => {
    expect(queueMessageText({ text: "", hasVisual: true })).toBe(" ");
  });

  it("uses a space placeholder for empty text even without visuals", () => {
    expect(queueMessageText({ text: "", hasVisual: false })).toBe(" ");
  });

  it("falls back to the raw text", () => {
    expect(queueMessageText({ text: "hi", hasVisual: false })).toBe("hi");
  });
});

describe("agentTextFor and displayTextFor", () => {
  it("placeholder the agent text when empty", () => {
    expect(agentTextFor("", true)).toBe(" ");
    expect(agentTextFor("", false)).toBe(" ");
    expect(agentTextFor("hi", false)).toBe("hi");
  });

  it("turn the display placeholder into an empty string", () => {
    expect(displayTextFor(" ")).toBe("");
    expect(displayTextFor("hi")).toBe("hi");
  });
});

describe("queueItemHasContent", () => {
  it("is false for blank text with no attachments", () => {
    expect(queueItemHasContent({ text: "   " })).toBe(false);
  });

  it("is true when any attachment array is non-empty", () => {
    expect(queueItemHasContent({ text: "", images: [{}] })).toBe(true);
    expect(queueItemHasContent({ text: "", citations: [{}] })).toBe(true);
    expect(queueItemHasContent({ text: "", elementTags: [{}] })).toBe(true);
  });

  it("is true for non-blank text", () => {
    expect(queueItemHasContent({ text: "hi" })).toBe(true);
  });
});

describe("steerTextWithCitations", () => {
  it("returns the base text when there are no usable citations", () => {
    expect(steerTextWithCitations({ text: "hi" })).toBe("hi");
    expect(steerTextWithCitations({ text: "hi", citations: [{}] })).toBe("hi");
  });

  it("appends a references block", () => {
    const out = steerTextWithCitations({
      agentText: "look",
      text: "shown",
      citations: [{ url: "https://a.dev", text: "A" }],
    });
    expect(out).toBe("look\n\nReferences:\n- https://a.dev (A)");
  });

  it("truncates long citation text", () => {
    const out = steerTextWithCitations({
      text: "x",
      citations: [{ url: "u", text: "y".repeat(200) }],
    });
    expect(out).toContain(`(${"y".repeat(160)})`);
    expect(out).not.toContain("y".repeat(161));
  });

  it("prefers agentText over display text", () => {
    expect(steerTextWithCitations({ agentText: "agent", text: "display" })).toBe("agent");
  });
});

describe("titleSeedFor", () => {
  it("prefers the display text", () => {
    expect(titleSeedFor("hi", { content: "c" })).toBe("hi");
  });

  it("falls back to the first tag content then label", () => {
    expect(titleSeedFor("", { content: "c", label: "l" })).toBe("c");
    expect(titleSeedFor("", { label: "l" })).toBe("l");
    expect(titleSeedFor("", undefined)).toBe("");
  });
});