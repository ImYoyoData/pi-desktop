import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createStreamBlockSplitter,
  markdownRootClassName,
  parseMarkdownRaw,
} from "../../src/renderer/src/utils/markdown";

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

  it("escapes link text so angle brackets cannot break the markup", () => {
    const html = parseMarkdownRaw("[a < b & c](https://x.test)");
    expect(html).toContain("a &lt; b &amp; c");
    expect(html).not.toContain("a < b");
  });
});

describe("markdown root class list", () => {
  it("keeps variant and CSS module classes as separate class names", () => {
    const classes = markdownRootClassName("chat", "root_hash", "assistant-md").split(" ");
    expect(classes).toEqual(["md", "md-chat", "root_hash", "assistant-md"]);
  });

  it("omits the chat variant class in the default variant", () => {
    const classes = markdownRootClassName("default", "root_hash").split(" ");
    expect(classes).toEqual(["md", "root_hash"]);
  });
});

describe("stream block splitter", () => {
  it("tracks the open fence so a trailing code block can be rendered as markdown", () => {
    const splitter = createStreamBlockSplitter();
    splitter.take("```ts\nconst a = 1;\n");
    expect(splitter.inFence).toBe(true);
  });

  it("records where the last closed fence ended", () => {
    const splitter = createStreamBlockSplitter();
    const source = "```ts\nconst a = 1;\n```\n";
    splitter.take(source);
    expect(splitter.inFence).toBe(false);
    expect(splitter.closedFenceEnd).toBe(source.length);
  });
});

describe("MarkdownView module stylesheet", () => {
  it("keeps markdown markup class names global so CSS modules do not hash them", () => {
    const cssPath = path.resolve(
      __dirname,
      "../../src/renderer/src/components/MarkdownView.module.css",
    );
    const css = readFileSync(cssPath, "utf8").replace(/:global\([^)]*\)/g, "");
    expect(css).not.toMatch(/\.hljs\b/);
  });
});
