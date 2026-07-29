import { describe, expect, it } from "vitest";
import { resolveTtsBinaryAsset, sanitizeTtsText } from "../../src/shared/tts";

describe("sanitizeTtsText", () => {
  it("strips fenced code and keeps surrounding prose", () => {
    const out = sanitizeTtsText("你好\n```js\nconsole.log(1)\n```\n世界");
    expect(out).toBe("你好 世界");
  });

  it("strips mermaid / unclosed trailing fence", () => {
    const out = sanitizeTtsText("说明如下：\n```mermaid\ngraph TD; A-->B\n```\n结束");
    expect(out).toBe("说明如下： 结束");
  });

  it("strips inline code and emphasis markers", () => {
    expect(sanitizeTtsText("用 `npm install` 安装 **依赖**")).toBe("用 安装 依赖");
  });

  it("keeps link text and drops images", () => {
    expect(sanitizeTtsText("见 [文档](https://example.com) 和 ![图](a.png)")).toBe("见 文档 和");
  });

  it("flattens table cells into prose", () => {
    const md = ["| 名称 | 值 |", "| --- | --- |", "| a | 1 |", "", "以上"].join("\n");
    const out = sanitizeTtsText(md);
    expect(out).toContain("名称");
    expect(out).toContain("以上");
    expect(out).not.toContain("|");
  });

  it("strips html pre/code", () => {
    expect(sanitizeTtsText("前<pre>secret</pre>后")).toBe("前 后");
  });
});

describe("resolveTtsBinaryAsset", () => {
  it("returns windows amd64 zip", () => {
    const a = resolveTtsBinaryAsset("win32", "x64");
    expect(a?.archive).toBe("zip");
    expect(a?.url).toContain("piper_windows_amd64.zip");
  });

  it("returns macos arm64 tar", () => {
    const a = resolveTtsBinaryAsset("darwin", "arm64");
    expect(a?.archive).toBe("tar.gz");
    expect(a?.url).toContain("piper_macos_aarch64.tar.gz");
  });
});
