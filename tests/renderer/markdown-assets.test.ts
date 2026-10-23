import { describe, expect, it } from "vitest";
import {
  isAbsoluteFsPath,
  joinPath,
  normalizePath,
  parentDir,
  relativePath,
} from "../../src/renderer/src/utils/fs-path";
import {
  localFileSrc,
  resolveMarkdownImageSrc,
} from "../../src/renderer/src/utils/markdown-assets";
import {
  ALLOWED_URI_REGEXP,
  parseMarkdownRaw,
} from "../../src/renderer/src/utils/markdown";

const REPO = "F:/Code/Work/pi-desktop";
const DOC_DIR = "F:/Code/Work/pi-desktop/docs";

describe("fs-path", () => {
  it("joins relative segments and eats . / ..", () => {
    expect(joinPath(DOC_DIR, "a.png")).toBe(`${DOC_DIR}/a.png`);
    expect(joinPath(DOC_DIR, "./a.png")).toBe(`${DOC_DIR}/a.png`);
    expect(joinPath(DOC_DIR, "../a.png")).toBe("F:/Code/Work/pi-desktop/a.png");
    expect(joinPath(DOC_DIR, "../../a.png")).toBe("F:/Code/Work/a.png");
  });

  it("keeps the windows drive and posix root", () => {
    expect(joinPath("C:/docs", "img/a.png")).toBe("C:/docs/img/a.png");
    expect(joinPath("/home/u/docs", "../a.png")).toBe("/home/u/a.png");
    expect(joinPath("/home/u/docs", "../../a.png")).toBe("/home/a.png");
  });

  it("normalizes absolute paths", () => {
    expect(normalizePath("C:/docs/./sub/../a.png")).toBe("C:/docs/a.png");
    expect(normalizePath("C:\\docs\\a.png")).toBe("C:/docs/a.png");
  });

  it("reports the parent directory", () => {
    expect(parentDir(`${DOC_DIR}/readme.md`)).toBe(DOC_DIR);
    expect(parentDir("readme.md")).toBe("");
  });

  it("detects absolute paths", () => {
    expect(isAbsoluteFsPath("C:/docs/a.png")).toBe(true);
    expect(isAbsoluteFsPath("C:\\docs\\a.png")).toBe(true);
    expect(isAbsoluteFsPath("/home/u/a.png")).toBe(true);
    expect(isAbsoluteFsPath("docs/a.png")).toBe(false);
  });

  it("computes the relative path inside the root only", () => {
    expect(relativePath(REPO, `${REPO}/resources/icon.svg`)).toBe(
      "resources/icon.svg",
    );
    expect(relativePath(REPO, "F:/Code/Work/other/a.png")).toBeNull();
    expect(relativePath(REPO, REPO)).toBeNull();
    expect(relativePath(REPO, "C:/other/a.png")).toBeNull();
  });
});

describe("resolveMarkdownImageSrc", () => {
  const base = { dir: DOC_DIR, root: REPO };

  it("resolves relative paths against the document directory", () => {
    expect(resolveMarkdownImageSrc("img/a.png", base)).toBe(
      "pi-local://media/?p=docs%2Fimg%2Fa.png",
    );
    expect(resolveMarkdownImageSrc("./img/a.png", base)).toBe(
      "pi-local://media/?p=docs%2Fimg%2Fa.png",
    );
    expect(resolveMarkdownImageSrc("../a.png", base)).toBe(
      "pi-local://media/?p=a.png",
    );
  });

  it("resolves paths outside the workspace to absolute addresses", () => {
    expect(resolveMarkdownImageSrc("../../../a.png", base)).toBe(
      "pi-local://media/?p=F%3A%2FCode%2Fa.png",
    );
  });

  it("keeps remote and inline addresses untouched", () => {
    expect(resolveMarkdownImageSrc("https://img.shields.io/x.png", base)).toBe(
      "https://img.shields.io/x.png",
    );
    expect(resolveMarkdownImageSrc("http://example.com/x.png", base)).toBe(
      "http://example.com/x.png",
    );
    expect(resolveMarkdownImageSrc("data:image/png;base64,AAA", base)).toBe(
      "data:image/png;base64,AAA",
    );
    expect(resolveMarkdownImageSrc("//example.com/x.png", base)).toBe(
      "https://example.com/x.png",
    );
  });

  it("treats windows drive letters as local paths", () => {
    expect(resolveMarkdownImageSrc("C:/tmp/a.png", base)).toBe(
      "pi-local://media/?p=C%3A%2Ftmp%2Fa.png",
    );
  });

  it("converts file urls to local addresses", () => {
    expect(resolveMarkdownImageSrc("file:///C:/tmp/a.png", base)).toBe(
      "pi-local://media/?p=C%3A%2Ftmp%2Fa.png",
    );
  });

  it("returns null without a base directory", () => {
    expect(resolveMarkdownImageSrc("img/a.png", null)).toBeNull();
    expect(resolveMarkdownImageSrc("", base)).toBeNull();
  });

  it("decodes percent encoded paths", () => {
    expect(resolveMarkdownImageSrc("./my%20image.png", base)).toBe(
      "pi-local://media/?p=docs%2Fmy%20image.png",
    );
  });

  it("builds workspace relative addresses when inside the root", () => {
    expect(localFileSrc(`${REPO}/a.png`, REPO)).toBe(
      "pi-local://media/?p=a.png",
    );
  });
});

describe("markdown image rendering", () => {
  it("rewrites relative image sources to local addresses", () => {
    const html = parseMarkdownRaw(
      "![icon](resources/icon.svg)",
      { dir: REPO, root: REPO },
    );
    expect(html).toContain("src=\"pi-local://media/?p=resources%2Ficon.svg\"");
  });

  it("keeps remote image sources", () => {
    const html = parseMarkdownRaw(
      "![version](https://img.shields.io/x.png)",
      { dir: REPO, root: REPO },
    );
    expect(html).toContain("src=\"https://img.shields.io/x.png\"");
  });

  it("keeps the original source without a base directory", () => {
    const html = parseMarkdownRaw("![icon](resources/icon.svg)");
    expect(html).toContain("src=\"resources/icon.svg\"");
  });
});

describe("sanitizer uri rules", () => {
  it("allows app internal protocols", () => {
    expect(
      ALLOWED_URI_REGEXP.test("pi-local://media/?p=a.png"),
    ).toBe(true);
    expect(ALLOWED_URI_REGEXP.test("pi-media://file/?p=a.png")).toBe(true);
  });

  it("still blocks script protocols", () => {
    expect(ALLOWED_URI_REGEXP.test("javascript:alert(1)")).toBe(false);
    expect(ALLOWED_URI_REGEXP.test("data:text/html;base64,AAA")).toBe(false);
  });
});
