import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPreview } from "../../src/main/preview-host";

describe("preview-host", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desk-preview-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads utf-8 text files", () => {
    fs.writeFileSync(path.join(root, "a.ts"), "export const x = 1;\n", "utf8");
    const result = readPreview(root, "a.ts");
    expect(result).toEqual({
      kind: "text",
      path: "a.ts",
      content: "export const x = 1;\n",
    });
  });

  it("reads markdown files", () => {
    fs.writeFileSync(path.join(root, "readme.md"), "# Hi\n", "utf8");
    const result = readPreview(root, "readme.md");
    expect(result).toEqual({
      kind: "markdown",
      path: "readme.md",
      content: "# Hi\n",
    });
  });

  it("returns image preview as data URL", () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001",
      "hex",
    );
    fs.writeFileSync(path.join(root, "icon.png"), png);
    const result = readPreview(root, "icon.png");
    expect(result.kind).toBe("image");
    if (result.kind === "image") {
      expect(result.path).toBe("icon.png");
      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    }
  });

  it("caps text reads at 1.5MB", () => {
    const big = "x".repeat(1.5 * 1024 * 1024 + 100);
    fs.writeFileSync(path.join(root, "big.txt"), big, "utf8");
    const result = readPreview(root, "big.txt");
    expect(result.kind).toBe("text");
    if (result.kind === "text") {
      expect(result.content.length).toBe(1.5 * 1024 * 1024);
      expect(result.truncated).toBe(true);
    }
  });

  it("returns unsupported for unknown binary types", () => {
    fs.writeFileSync(path.join(root, "app.exe"), Buffer.from([0, 1, 2, 3]));
    const result = readPreview(root, "app.exe");
    expect(result).toEqual({ kind: "unsupported", path: "app.exe", reason: "binary" });
  });

  it("opens unknown text-like extensions in the text editor", () => {
    fs.writeFileSync(path.join(root, "notes.weird"), "hello plain text\n", "utf8");
    const result = readPreview(root, "notes.weird");
    expect(result).toEqual({
      kind: "text",
      path: "notes.weird",
      content: "hello plain text\n",
    });
  });

  it("returns video preview with local media src", () => {
    fs.writeFileSync(path.join(root, "clip.mp4"), Buffer.from([0, 0, 0, 1]));
    const result = readPreview(root, "clip.mp4");
    expect(result.kind).toBe("video");
    if (result.kind === "video") {
      expect(result.path).toBe("clip.mp4");
      expect(result.mediaSrc).toMatch(/^pi-local:\/\/media\/\?p=/);
    }
  });

  it("returns audio preview with local media src", () => {
    fs.writeFileSync(path.join(root, "track.mp3"), Buffer.from([0xff, 0xfb, 0x90]));
    const result = readPreview(root, "track.mp3");
    expect(result.kind).toBe("audio");
    if (result.kind === "audio") {
      expect(result.mediaSrc).toContain(encodeURIComponent("track.mp3"));
    }
  });

  it("returns error when path escapes workspace", () => {
    const result = readPreview(root, "../outside.txt");
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toMatch(/escapes workspace/i);
    }
  });
});
