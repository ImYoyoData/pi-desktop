import { describe, expect, it } from "vitest";
import { normalizeDiffHunks } from "../../src/renderer/src/utils/diff-view-hunks";

describe("normalizeDiffHunks", () => {
  it("补全裸 @@ 的行号", () => {
    const text = normalizeDiffHunks(
      ["--- a/x.ts", "+++ b/x.ts", "@@", "-old", "+new"].join("\n"),
      "x.ts",
    );
    expect(text).toBe(
      ["--- a/x.ts", "+++ b/x.ts", "@@ -1,1 +1,1 @@", "-old", "+new"].join("\n"),
    );
  });

  it("按前一个块的增删行数推进后续裸 @@ 的位置", () => {
    const text = normalizeDiffHunks(
      [
        "--- a/x.ts",
        "+++ b/x.ts",
        "@@",
        " keep",
        "-a",
        "+b",
        "+c",
        "@@",
        "-d",
        "+e",
      ].join("\n"),
      "x.ts",
    );
    const headers = text!.split("\n").filter((line) => line.startsWith("@@ "));
    expect(headers).toEqual(["@@ -1,2 +1,3 @@", "@@ -3,1 +4,1 @@"]);
  });

  it("保留已经带行号的 hunk 头", () => {
    const patch = ["--- a/x.ts", "+++ b/x.ts", "@@ -10,1 +10,1 @@", "-a", "+b"].join("\n");
    expect(normalizeDiffHunks(patch, "x.ts")).toBe(patch);
  });

  it("没有文件头时按路径补一对", () => {
    const text = normalizeDiffHunks(["@@", "-a", "+b"].join("\n"), "src/x.ts");
    expect(text).toBe(
      ["--- a/src/x.ts", "+++ b/src/x.ts", "@@ -1,1 +1,1 @@", "-a", "+b"].join("\n"),
    );
  });

  it("非 diff 文本返回 null", () => {
    expect(normalizeDiffHunks("just some command output", "x.ts")).toBeNull();
    expect(normalizeDiffHunks("", "x.ts")).toBeNull();
  });
});
