import { describe, expect, it } from "vitest";
import { grepOpenPath, parseGrepOutput } from "../../src/renderer/src/utils/grep-card";
import { parseToolCard, toolCardHasBody } from "../../src/renderer/src/utils/tool-diff";

const OUTPUT = [
  "src/renderer/src/App.tsx:12: const a = 1;",
  "src/renderer/src/App.tsx:20: const b = 2;",
  "src/main/index.ts:5: import x from 'y';",
].join("\n");

describe("parseGrepOutput", () => {
  it("groups hits per file and counts matches", () => {
    const parsed = parseGrepOutput(OUTPUT);
    expect(parsed.hits).toHaveLength(2);
    expect(parsed.hits[0]!.path).toBe("src/renderer/src/App.tsx");
    expect(parsed.hits[0]!.lines.map((row) => row.line)).toEqual([12, 20]);
    expect(parsed.matchCount).toBe(3);
    expect(parsed.noMatches).toBe(false);
    expect(parsed.notices).toEqual([]);
  });

  it("keeps context lines apart from match lines", () => {
    const parsed = parseGrepOutput(
      ["a.ts-9- before", "a.ts:10: hit", "a.ts-11- after"].join("\n"),
    );
    const lines = parsed.hits[0]!.lines;
    expect(parsed.matchCount).toBe(1);
    expect(lines.map((row) => row.match)).toEqual([false, true, false]);
    expect(lines[0]!.text).toBe("before");
  });

  it("strips the trailing limit notice out of the hits", () => {
    const parsed = parseGrepOutput(
      `${OUTPUT}\n\n[100 matches limit reached. Use limit=200 for more, or refine pattern]`,
    );
    expect(parsed.notices).toHaveLength(1);
    expect(parsed.notices[0]).toContain("100 matches limit reached");
    expect(parsed.matchCount).toBe(3);
    expect(parsed.text).not.toContain("limit reached");
  });

  it("marks a no-match result", () => {
    const parsed = parseGrepOutput("No matches found");
    expect(parsed.noMatches).toBe(true);
    expect(parsed.matchCount).toBe(0);
    expect(parsed.hits).toEqual([]);
  });

  // 工具偏好会在空结果后追加 .gitignore 说明，卡片摘要仍需认出来。
  it("marks a no-match result that carries the ignore explanation", () => {
    const parsed = parseGrepOutput(
      "No matches found\n\ngrep skips .gitignore'd paths (node_modules, out, build, release).",
    );
    expect(parsed.noMatches).toBe(true);
    expect(parsed.hits).toEqual([]);
    expect(parsed.text).toContain("grep skips");
  });

  it("does not invent hits from an error message", () => {
    const parsed = parseGrepOutput("Path not found: /tmp/app");
    expect(parsed.hits).toEqual([]);
    expect(parsed.text).toContain("Path not found");
  });
});

describe("grepOpenPath", () => {
  it("joins a directory search root", () => {
    expect(grepOpenPath("src/renderer", "components/App.tsx")).toBe(
      "src/renderer/components/App.tsx",
    );
  });

  it("keeps the search root when it points at a single file", () => {
    expect(grepOpenPath("src/App.tsx", "App.tsx")).toBe("src/App.tsx");
  });

  it("recognizes an extensionless single-file search", () => {
    expect(grepOpenPath("Dockerfile", "Dockerfile")).toBe("Dockerfile");
    expect(grepOpenPath("deploy/Makefile", "Makefile")).toBe("deploy/Makefile");
  });

  it("passes paths through when searching from the workspace root", () => {
    expect(grepOpenPath(".", "package.json")).toBe("package.json");
    expect(grepOpenPath(null, "src/a.ts")).toBe("src/a.ts");
  });

  it("resolves an absolute search root", () => {
    expect(grepOpenPath("/proj/src", "a.ts")).toBe("/proj/src/a.ts");
  });
});

describe("grep tool card", () => {
  it("carries pattern, scope and flags from the call args", () => {
    const card = parseToolCard(
      "grep",
      { pattern: "ToolCard", path: "src/renderer", glob: "*.tsx", ignoreCase: true },
      { content: [{ type: "text", text: "components/A.tsx:10: const ToolCard = 1;" }] },
    );
    expect(card.kind).toBe("grep");
    if (card.kind !== "grep") return;
    expect(card.pattern).toBe("ToolCard");
    expect(card.searchPath).toBe("src/renderer");
    expect(card.glob).toBe("*.tsx");
    expect(card.ignoreCase).toBe(true);
    expect(card.matchCount).toBe(1);
    expect(toolCardHasBody(card)).toBe(true);
  });

  it("drops the body affordance when there is nothing to show", () => {
    const card = parseToolCard("grep", { pattern: "x" }, undefined);
    if (card.kind !== "grep") throw new Error("expected grep card");
    expect(toolCardHasBody(card)).toBe(false);
  });
});
