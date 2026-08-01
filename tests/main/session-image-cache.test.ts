import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteImageCache,
  imageCacheDirFor,
  saveImageDataUrl,
} from "../../src/main/session-image-cache";

describe("session-image-cache", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-desktop-imgcache-"));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("saves a data-URL image under the session attachments folder", () => {
    const sessionFile = path.join(tempRoot, "session.jsonl");
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const saved = saveImageDataUrl(sessionFile, dataUrl);
    expect(path.dirname(saved.filePath)).toBe(imageCacheDirFor(sessionFile));
    expect(saved.mimeType).toBe("image/png");
    expect(fs.existsSync(saved.filePath)).toBe(true);
    expect(fs.readFileSync(saved.filePath).toString("base64")).toBe("iVBORw0KGgo=");
  });

  it("rejects non-image data URLs", () => {
    expect(() => saveImageDataUrl(path.join(tempRoot, "s.jsonl"), "data:text/plain;base64,AAAA")).toThrow();
  });

  it("deletes the whole attachments folder", () => {
    const sessionFile = path.join(tempRoot, "session.jsonl");
    saveImageDataUrl(sessionFile, "data:image/png;base64,iVBORw0KGgo=");
    const dir = imageCacheDirFor(sessionFile);
    expect(fs.existsSync(dir)).toBe(true);
    deleteImageCache(sessionFile);
    expect(fs.existsSync(dir)).toBe(false);
  });
});
