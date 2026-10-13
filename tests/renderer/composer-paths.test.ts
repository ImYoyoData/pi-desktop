import { describe, expect, it } from "vitest";
import {
  coercePathToken,
  fileUrlToPath,
  toWorkspaceRelative,
  transferTypesHaveFilePayload,
  type WorkspacePathContext,
} from "../../src/renderer/src/utils/composer-paths";

const win: WorkspacePathContext = { root: "F:\\Code\\Work", caseInsensitive: true };
const posix: WorkspacePathContext = { root: "/home/me/proj", caseInsensitive: false };
const noRoot: WorkspacePathContext = { root: "", caseInsensitive: false };

describe("toWorkspaceRelative", () => {
  it("returns the path untouched when no workspace is open", () => {
    expect(toWorkspaceRelative("C:\\any\\file.txt", noRoot)).toBe("C:/any/file.txt");
  });

  it("strips the workspace root prefix", () => {
    expect(toWorkspaceRelative("F:\\Code\\Work\\a\\b.ts", win)).toBe("a/b.ts");
    expect(toWorkspaceRelative("/home/me/proj/src/x.ts", posix)).toBe("src/x.ts");
  });

  it("returns an empty string for the workspace root itself", () => {
    expect(toWorkspaceRelative("F:\\Code\\Work", win)).toBe("");
    expect(toWorkspaceRelative("/home/me/proj", posix)).toBe("");
  });

  it("leaves sibling paths that merely share a prefix", () => {
    expect(toWorkspaceRelative("F:\\Code\\Work2\\a.ts", win)).toBe("F:/Code/Work2/a.ts");
  });

  it("honours case-insensitive roots but not case-sensitive ones", () => {
    expect(toWorkspaceRelative("f:\\code\\work\\A.ts", win)).toBe("A.ts");
    expect(toWorkspaceRelative("/HOME/ME/PROJ/a.ts", posix)).toBe("/HOME/ME/PROJ/a.ts");
  });

  it("ignores trailing slashes on the root", () => {
    const ctx: WorkspacePathContext = { root: "/home/me/proj///", caseInsensitive: false };
    expect(toWorkspaceRelative("/home/me/proj/a.ts", ctx)).toBe("a.ts");
  });
});

describe("fileUrlToPath", () => {
  it("converts a windows file URL to a drive path, normalised to forward slashes", () => {
    // 盘符先还原成反斜杠，随后 toWorkspaceRelative 统一归一化为正斜杠。
    expect(fileUrlToPath("file:///C:/Users/me/a.txt", noRoot)).toBe("C:/Users/me/a.txt");
  });

  it("decodes percent escapes", () => {
    expect(fileUrlToPath("file:///C:/my%20dir/a.txt", noRoot)).toBe("C:/my dir/a.txt");
  });

  it("keeps posix file URLs on their own separator", () => {
    expect(fileUrlToPath("file:///home/me/proj/src/a.txt", posix)).toBe("src/a.txt");
  });

  it("leaves paths outside the workspace untouched", () => {
    expect(fileUrlToPath("file:///home/me/other/a.txt", posix)).toBe("/home/me/other/a.txt");
  });

  it("accepts raw absolute paths", () => {
    expect(fileUrlToPath("C:\\Users\\me\\a.txt", noRoot)).toBe("C:/Users/me/a.txt");
    expect(fileUrlToPath("\\\\server\\share\\a.txt", noRoot)).toBe("//server/share/a.txt");
    expect(fileUrlToPath("/home/me/proj/a.txt", posix)).toBe("a.txt");
  });

  it("returns null for blanks and non-paths", () => {
    expect(fileUrlToPath("   ", posix)).toBeNull();
    expect(fileUrlToPath("README.md", posix)).toBeNull();
    expect(fileUrlToPath("https://example.com/a.png", posix)).toBeNull();
  });
});

describe("coercePathToken", () => {
  it("resolves absolute and file:// tokens against the workspace", () => {
    expect(coercePathToken("/home/me/proj/src/a.ts", posix)).toBe("src/a.ts");
    expect(coercePathToken("file:///home/me/proj/src/a.ts", posix)).toBe("src/a.ts");
  });

  it("drops a token that resolves to the workspace root itself", () => {
    expect(coercePathToken("/home/me/proj", posix)).toBeNull();
  });

  it("normalises workspace-relative tokens", () => {
    expect(coercePathToken("./src/a.ts", posix)).toBe("src/a.ts");
    expect(coercePathToken("src\\a.ts", posix)).toBe("src/a.ts");
    expect(coercePathToken('"src/my file.ts"', posix)).toBe("src/my file.ts");
  });

  it("rejects prose and URLs", () => {
    expect(coercePathToken("just some text", posix)).toBeNull();
    expect(coercePathToken("https://example.com", posix)).toBeNull();
  });
});

describe("transferTypesHaveFilePayload", () => {
  it("accepts the custom MIME, file lists, uri-list and plain text", () => {
    expect(transferTypesHaveFilePayload(["application/x-pi-workspace-paths"])).toBe(true);
    expect(transferTypesHaveFilePayload(["Files"])).toBe(true);
    expect(transferTypesHaveFilePayload(["text/uri-list"])).toBe(true);
    expect(transferTypesHaveFilePayload(["text/plain"])).toBe(true);
  });

  it("rejects unrelated payloads", () => {
    expect(transferTypesHaveFilePayload(["text/html"])).toBe(false);
    expect(transferTypesHaveFilePayload([])).toBe(false);
  });
});