import { describe, expect, it } from "vitest";
import {
  directoryListTarget,
  genericStepPreview,
  genericStepTarget,
  isDirectoryListTool,
  isPathListTool,
  parsePathList,
  parseScriptReport,
  pathListEntries,
} from "../../src/renderer/src/utils/structured-text";

const LS_OUTPUT = `_ui-preview/
.codegraph/
.git/
.gitattributes
.github/
AGENTS.md
package.json
src/`;

const REPORT = `Script completed
Wall time 0.5 seconds
Output:
==> text 1/6 <==
===== src/renderer/src/utils/editor-lang.ts =====
export function languageFromPath(filePath: string): string {
  return "typescript";
}

==> text 2/6 <==
plain text body
<console_output>
[pi] tool result cached`;

describe("isPathListTool", () => {
  it("recognizes pi built-ins and MCP names", () => {
    expect(isPathListTool("ls")).toBe(true);
    expect(isPathListTool("find")).toBe(true);
    expect(isPathListTool("mcp__fs__list_directory")).toBe(true);
  });

  it("does not match unrelated tools", () => {
    expect(isPathListTool("read")).toBe(false);
    expect(isPathListTool("bash")).toBe(false);
  });
});

describe("pathListEntries", () => {
  it("drops the ls truncation notice", () => {
    const entries = pathListEntries(`${LS_OUTPUT}\n\n[500 entries limit reached]`);
    expect(entries).toHaveLength(8);
    expect(entries.some((entry) => entry.startsWith("["))).toBe(false);
  });
});

describe("parsePathList", () => {
  it("detects a list of paths", () => {
    expect(parsePathList(LS_OUTPUT)).toEqual([
      "_ui-preview/",
      ".codegraph/",
      ".git/",
      ".gitattributes",
      ".github/",
      "AGENTS.md",
      "package.json",
      "src/",
    ]);
  });

  it("rejects prose", () => {
    expect(parsePathList("hello\nworld")).toBeNull();
  });

  it("rejects a single line", () => {
    expect(parsePathList("src/app.ts")).toBeNull();
  });
});

describe("isDirectoryListTool", () => {
  it("matches directory listing tools only", () => {
    expect(isDirectoryListTool("ls")).toBe(true);
    expect(isDirectoryListTool("mcp__fs__list_directory")).toBe(true);
    expect(isDirectoryListTool("find")).toBe(false);
    expect(isDirectoryListTool("read")).toBe(false);
  });
});

describe("directoryListTarget", () => {
  it("uses the workspace folder name for the root path", () => {
    expect(directoryListTarget({ path: "." }, "F:\\Code\\Work\\pi-desktop")).toBe("pi-desktop");
  });

  it("keeps explicit subdirectory paths as they are", () => {
    expect(directoryListTarget({ path: "src/renderer/src" }, "F:\\Code\\Work\\pi-desktop")).toBe(
      "src/renderer/src",
    );
  });

  it("falls back to the raw path without a workspace", () => {
    expect(directoryListTarget({ path: "." }, null)).toBe(".");
  });

  it("treats a missing path argument as the workspace root", () => {
    expect(directoryListTarget({}, "F:\\Code\\Work\\pi-desktop")).toBe("pi-desktop");
  });
});

describe("genericStepTarget", () => {
  it("returns the path the tool operated on", () => {
    expect(genericStepTarget({ path: "src/renderer/src" })).toBe("src/renderer/src");
  });

  it("falls back to the command, then to the query", () => {
    expect(genericStepTarget({ command: "npm test" })).toBe("npm test");
    expect(genericStepTarget({ query: "tool result" })).toBe("tool result");
  });

  it("returns null when there is no path-like argument", () => {
    expect(genericStepTarget({ limit: 10 })).toBeNull();
  });

  it("uses the first code line as the target of a script tool", () => {
    expect(genericStepTarget({ code: "const a = 1;\nconst b = 2;" })).toBe("const a = 1;");
  });
});

describe("genericStepPreview", () => {
  it("counts path list entries instead of showing their content", () => {
    const card = { preview: LS_OUTPUT, structured: null };
    expect(genericStepPreview(card, "ls")).toEqual({ kind: "count", count: 8 });
  });

  it("summarises a JSON result by its top-level keys", () => {
    const card = { preview: null, structured: { path: ".", entries: [], total: 3 } };
    expect(genericStepPreview(card, "mcp__fs__list")).toEqual({
      kind: "keys",
      keys: ["path", "entries", "total"],
    });
  });

  it("summarises a script report by its section count", () => {
    const card = { preview: REPORT, structured: null };
    expect(genericStepPreview(card, "codemode")).toEqual({
      kind: "sections",
      count: 2,
      wallTime: "Wall time 0.5 seconds",
    });
  });

  it("returns null when there is nothing to summarise", () => {
    expect(genericStepPreview({ preview: "just text", structured: null }, "x")).toBeNull();
  });

  it("ignores the empty-directory placeholder", () => {
    expect(parsePathList("(empty directory)")).toBeNull();
  });
});

describe("parseScriptReport", () => {
  it("parses status, wall time and sections", () => {
    const report = parseScriptReport(REPORT);
    expect(report?.status).toBe("completed");
    expect(report?.wallTime).toBe("Wall time 0.5 seconds");
    expect(report?.sections).toHaveLength(2);
    expect(report?.sections[0]?.title).toBe("text 1/6");
    expect(report?.sections[1]?.title).toBe("text 2/6");
  });

  it("splits file sections into code blocks", () => {
    const report = parseScriptReport(REPORT);
    const blocks = report?.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "code",
      path: "src/renderer/src/utils/editor-lang.ts",
    });
  });

  it("extracts the console block", () => {
    const report = parseScriptReport(REPORT);
    const blocks = report?.sections[1]?.blocks ?? [];
    expect(blocks.some((block) => block.kind === "console")).toBe(true);
    expect(blocks.some((block) => block.kind === "text")).toBe(true);
  });

  it("returns null for text that is not a report", () => {
    expect(parseScriptReport("just some output")).toBeNull();
  });

  it("captures the error of a failed script", () => {
    const report = parseScriptReport(
      "Script failed\nWall time 0.2 seconds\nOutput:\npartial output\nScript error: boom",
    );
    expect(report?.status).toBe("failed");
    expect(report?.error).toBe("boom");
  });
});
