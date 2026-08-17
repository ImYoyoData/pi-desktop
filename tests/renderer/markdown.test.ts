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

  it("emits mermaid placeholder instead of a highlighted code block", () => {
    const src = [
      "```mermaid",
      "flowchart LR",
      '  A["UI"] --> B["Main"]',
      "```",
    ].join("\n");
    const html = parseMarkdownRaw(src);
    expect(html).toContain("data-mermaid");
    expect(html).toContain("md-diagram-src");
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain("data-code-block");
  });

  it("treats flowchart fences and untitled flowchart sources as mermaid", () => {
    const named = ["```flowchart", "flowchart TD", "  A --> B", "```"].join("\n");
    const bare = ["```", "flowchart TD", "  A[开始] --> B{判断}", "```"].join("\n");
    expect(parseMarkdownRaw(named)).toContain("data-mermaid");
    expect(parseMarkdownRaw(bare)).toContain("data-mermaid");
    expect(parseMarkdownRaw(bare)).toContain("A[开始]");
  });

  it("emits graphviz/dot placeholder", () => {
    const src = ["```dot", "digraph { a -> b }", "```"].join("\n");
    const html = parseMarkdownRaw(src);
    expect(html).toContain('data-diagram="dot"');
    expect(html).toContain("digraph");
  });

  it("renders display math code fences with katex", () => {
    const html = parseMarkdownRaw("```math\nE = mc^2\n```");
    expect(html).toContain("katex");
    expect(html).toContain("md-math-block");
  });

  it("emits line numbers beside highlighted code in one code-body", () => {
    const html = parseMarkdownRaw("```js\nconst a = 1;\nconst b = 2;\n```");
    expect(html).toContain('data-code-block');
    expect(html).toContain('class="code-body"');
    expect(html).toContain('class="line-nos"');
    expect(html).toContain("<span>1</span>");
    expect(html).toContain("<span>2</span>");
    expect(html).toContain("language-js");
  });

  it("renders inline and block dollar math", () => {
    const inline = parseMarkdownRaw("energy $E=mc^2$ here");
    expect(inline).toContain("katex");
    const block = parseMarkdownRaw("$$\na+b=c\n$$");
    expect(block).toContain("katex");
  });
});
