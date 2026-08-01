import { describe, expect, it } from "vitest";
import { BUILTIN_BROWSER_SELECTION_HEADER } from "../../src/shared/builtin-browser";
import { stripSelectionCitationsBlock } from "../../src/shared/chat-meta";

describe("stripSelectionCitationsBlock", () => {
  it("removes the browser-selection block the worker prepends", () => {
    const text = `${BUILTIN_BROWSER_SELECTION_HEADER}\n\nContext from browser selection:\n\n### Citation 1\n- URL: https://a\n- Text: hi\n\n---\n\n[pi-desktop mode: agent]\n\nDo the thing @file.ts`;
    expect(stripSelectionCitationsBlock(text)).toBe("[pi-desktop mode: agent]\n\nDo the thing @file.ts");
  });

  it("returns text unchanged when no selection block is present", () => {
    expect(stripSelectionCitationsBlock("plain message")).toBe("plain message");
  });
});
