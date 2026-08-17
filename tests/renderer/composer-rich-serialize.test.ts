import { describe, expect, it } from "vitest";
import {
  chipIdsFromRichHtml,
  extractDraftFromRichHtml,
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
