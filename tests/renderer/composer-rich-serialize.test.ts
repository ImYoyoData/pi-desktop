import { describe, expect, it } from "vitest";
import {
  chipIdsFromRichHtml,
  extractDraftFromRichHtml,
  needsLeadingSpace,
  normalizeInsertedText,
  plainTextFromClipboard,
  serializeRichEditor,
} from "../../src/renderer/src/utils/composer-rich";

describe("composer-rich", () => {
  it("extracts text without chip labels duplicated", () => {
    const html = `hello<span data-chip-id="c1" data-chip-kind="file">src/a.ts</span>world`;
    expect(extractDraftFromRichHtml(html).replace(/\s+/g, " ").trim()).toBe("hello world");
  });

  it("prefers clipboard text/plain and strips HTML formatting", () => {
    expect(
      plainTextFromClipboard("plain line", `<p style="color:red"><b>ignored</b></p>`),
    ).toBe("plain line");
    expect(
      plainTextFromClipboard("", `<p>Hello</p><p>World</p>`).replace(/\n+/g, "\n").trim(),
    ).toBe("Hello\nWorld");
    expect(plainTextFromClipboard("  a\r\nb  ", "")).toBe("  a\nb  ");
  });

  it("keeps clipboard payloads that are only whitespace", () => {
    expect(plainTextFromClipboard("    ", "")).toBe("    ");
    expect(plainTextFromClipboard("  ", "")).toBe("  ");
    expect(plainTextFromClipboard("\u3000\u3000", "")).toBe("\u3000\u3000");
    expect(plainTextFromClipboard("", "")).toBe("");
  });

  it("takes whitespace-only text/plain over HTML, and empty text/plain falls back to HTML", () => {
    expect(plainTextFromClipboard("   ", "<p>styled</p>")).toBe("   ");
    expect(plainTextFromClipboard("", "<span>   </span>")).toBe("   ");
    expect(plainTextFromClipboard("", "<p>Hello</p><p>World</p>").replace(/\n+/g, "\n").trim()).toBe("Hello\nWorld");
  });

  it("keeps leading and trailing whitespace when normalizing inserted text", () => {
    expect(normalizeInsertedText("  leading spaces")).toBe("  leading spaces");
    expect(normalizeInsertedText("padded  ")).toBe("padded  ");
    expect(normalizeInsertedText("    ")).toBe("    ");
    expect(normalizeInsertedText("a\u200Bb")).toBe("ab");
    expect(normalizeInsertedText("l1\r\nl2\rl3")).toBe("l1\nl2\nl3");
  });

  it("separates dropped text from preceding content without touching pasted text", () => {
    expect(needsLeadingSpace("abc", "url")).toBe(true);
    expect(needsLeadingSpace("abc", "  url")).toBe(true);
    expect(needsLeadingSpace("abc ", "url")).toBe(false);
    expect(needsLeadingSpace("", "url")).toBe(false);
    expect(needsLeadingSpace("abc", ",x")).toBe(false);
  });

  it("lists chip ids in document order", () => {
    const html = `<span data-chip-id="a" data-chip-kind="file">a.ts</span> x <span data-chip-id="b" data-chip-kind="url">https://ex.com</span>`;
    expect(chipIdsFromRichHtml(html)).toEqual(["a", "b"]);
  });

  it("serializes draft and chip order from an element-like root", () => {
    const root = {
      innerHTML: `hello<span data-chip-id="c1" data-chip-kind="file">src/a.ts</span>world`,
      querySelectorAll(selector: string): { getAttribute(name: string): string | null }[] {
        if (!selector.includes("data-chip-id")) return [];
        return [
          { getAttribute: (n: string) => (n === "data-chip-id" ? "c1" : null) },
        ];
      },
    };
    const { draft, chipOrder } = serializeRichEditor(root as unknown as HTMLElement);
    expect(draft.replace(/\s+/g, " ").trim()).toBe("hello world");
    expect(chipOrder).toEqual(["c1"]);
  });
});
