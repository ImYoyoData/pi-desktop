import { describe, expect, it } from "vitest";
import { parseMarkdownRaw } from "../../src/renderer/src/utils/markdown";

describe("parseMarkdownRaw (GFM)", () => {
  it("renders tables", () => {
    const html = parseMarkdownRaw("| a | b |\n|---|---|\n| 1 | 2 |\n");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>");
    expect(html).toContain("<td>");
  });

  it("renders unordered and ordered lists", () => {
    const ul = parseMarkdownRaw("- one\n- two\n");
    const ol = parseMarkdownRaw("1. a\n2. b\n");
    expect(ul).toContain("<ul>");
    expect(ul).toContain("<li>");
    expect(ol).toContain("<ol>");
  });

  it("renders task lists, strikethrough, blockquote", () => {
    const html = parseMarkdownRaw(
      "- [x] done\n- [ ] todo\n\n~~gone~~\n\n> tip\n",
    );
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<del>");
    expect(html).toContain("<blockquote>");
  });

  it("renders headings and hr", () => {
    const html = parseMarkdownRaw("# Title\n\n## Sub\n\n---\n");
    expect(html).toContain("<h1>");
    expect(html).toContain("<h2>");
    expect(html).toContain("<hr");
  });
});
