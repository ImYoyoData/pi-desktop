import { describe, expect, it } from "vitest";
import { getMarkdown, parseMarkdownToStructure } from "stream-markdown-parser";
import {
  MARKDOWN_HTML_PARSE_OPTIONS,
  MARKDOWN_PARSE_OPTIONS,
} from "../../src/renderer/src/components/markdown/html-policy";

const CENTERED_IMAGE = [
  '<p align="center">',
  '  <img src="docs/screenshots/chat-git-panel.png" alt="Pi Desktop" width="760" />',
  "</p>",
].join("\n");

const BADGE = [
  '<a href="https://github.com/ImYoyoData/pi-desktop">',
  '  <img alt="platform" src="https://img.shields.io/badge/platform-win-6B7280" />',
  "</a>",
].join("\n");

type ProbeNode = {
  type?: string;
  tag?: string;
  attrs?: Array<[string, string | null]>;
  children?: ProbeNode[];
};

function parse(content: string, options: typeof MARKDOWN_HTML_PARSE_OPTIONS): ProbeNode[] {
  return parseMarkdownToStructure(content, getMarkdown(), options) as ProbeNode[];
}

function attrsOf(node: ProbeNode | undefined): Map<string, string | null> {
  return new Map(node?.attrs ?? []);
}

describe("markdown html images", () => {
  it("turns an image container into an img node for the html preview parser", () => {
    const nodes = parse(CENTERED_IMAGE, MARKDOWN_HTML_PARSE_OPTIONS);
    expect(nodes[0]?.type).toBe("html_block");
    expect(nodes[0]?.tag).toBe("img");
    const attrs = attrsOf(nodes[0]);
    expect(attrs.get("src")).toBe("docs/screenshots/chat-git-panel.png");
    expect(attrs.get("width")).toBe("760");
    expect(attrs.get("align")).toBe("center");
  });

  it("keeps linked badges as raw html", () => {
    const nodes = parse(BADGE, MARKDOWN_HTML_PARSE_OPTIONS);
    expect(nodes[0]?.tag).toBe("a");
  });

  it("keeps plain html blocks untouched", () => {
    const nodes = parse('<p align="center">hello</p>', MARKDOWN_HTML_PARSE_OPTIONS);
    expect(nodes[0]?.type).toBe("html_block");
    expect(nodes[0]?.tag).toBe("p");
  });

  it("does not rewrite containers outside the file preview", () => {
    const nodes = parse(CENTERED_IMAGE, MARKDOWN_PARSE_OPTIONS);
    expect(nodes[0]?.tag).toBe("p");
  });
});

describe("markdown after html blocks", () => {
  const DOC = [
    '<h2 align="center">截图</h2>',
    "",
    '<p align="center">',
    '  <img src="docs/screenshots/chat-git-panel.png" alt="Pi Desktop" width="760" />',
    "</p>",
    "",
    "### 为什么选择 Pi Desktop?",
  ].join("\n");

  it("keeps parsing markdown that follows the html blocks", () => {
    const nodes = parse(DOC, MARKDOWN_HTML_PARSE_OPTIONS);
    expect(nodes.map((node) => node.type)).toEqual(["html_block", "html_block", "heading"]);
    expect(nodes[0]?.tag).toBe("h2");
    expect(nodes[1]?.tag).toBe("img");
  });
});
