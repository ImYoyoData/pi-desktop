import { describe, expect, it } from "vitest";
import { BUILTIN_BROWSER_SELECTION_HEADER } from "../../src/shared/builtin-browser";
import { stripAttachedImagesBlock, stripSelectionCitationsBlock } from "../../src/shared/chat-meta";

describe("stripSelectionCitationsBlock", () => {
  it("removes the browser-selection block the worker prepends", () => {
    const text = `${BUILTIN_BROWSER_SELECTION_HEADER}\n\nContext from browser selection:\n\n### Citation 1\n- URL: https://a\n- Text: hi\n\n---\n\n[pi-desktop mode: agent]\n\nDo the thing @file.ts`;
    expect(stripSelectionCitationsBlock(text)).toBe("[pi-desktop mode: agent]\n\nDo the thing @file.ts");
  });

  it("returns text unchanged when no selection block is present", () => {
    expect(stripSelectionCitationsBlock("plain message")).toBe("plain message");
  });

describe("stripAttachedImagesBlock", () => {
  it("removes the trailing [attached images] paths block", () => {
    const text = "Do the thing\n\n[attached images]\n- C:\\tmp\\img-a.png\n- C:\\tmp\\img-b.png";
    expect(stripAttachedImagesBlock(text)).toBe("Do the thing");
  });

  it("leaves text without the block unchanged", () => {
    expect(stripAttachedImagesBlock("plain message")).toBe("plain message");
  });
});
});
