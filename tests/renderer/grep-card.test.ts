import { describe, expect, it } from "vitest";
import { grepOpenPath, parseGrepOutput } from "../../src/renderer/src/utils/grep-card";
import { parseToolCard, toolCardExpandable } from "../../src/renderer/src/utils/tool-diff";

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

  // omp 的 grep 用 `*12|文本` 标命中、` 12|文本` 标 context，路径相对工作区。
  it("parses omp match rows for a single-file search", () => {
    const parsed = parseGrepOutput(
      ["*2|.toolCall {", " 3|  width: 100%;", "...", " 9|", "*10|.toolCall.askUserMuted {"].join(
        "\n",
      ),
      "src/renderer/src/components/ToolCallCard.module.css",
    );
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.path).toBe("src/renderer/src/components/ToolCallCard.module.css");
    expect(parsed.hits[0]!.pathBase).toBe("workspace");
    expect(parsed.matchCount).toBe(2);
    const rows = parsed.hits[0]!.lines;
    expect(rows.map((row) => row.line)).toEqual([2, 3, 0, 9, 10]);
    expect(rows.map((row) => row.match)).toEqual([true, false, false, false, true]);
    expect(rows[2]!.gap).toBe(true);
    expect(rows[3]!.text).toBe("");
  });

  it("rebuilds omp grouped paths from the header tree", () => {
    const parsed = parseGrepOutput(
      [
        "# src/",
        "## renderer/",
        "### components/",
        "#### ToolCallCard.module.css",
        "*37|.toolCallHead:hover {",
        "",
        "# src/",
        "## main/",
        "### index.ts",
        "*5|import x from 'y';",
      ].join("\n"),
    );
    expect(parsed.hits.map((group) => group.path)).toEqual([
      "src/renderer/components/ToolCallCard.module.css",
      "src/main/index.ts",
    ]);
    expect(parsed.matchCount).toBe(2);
    expect(parsed.hits.every((group) => group.pathBase === "workspace")).toBe(true);
  });

  it("parses omp hashline rows and strips the snapshot tag off the header", () => {
    const parsed = parseGrepOutput(
      ["# src/", "## app.ts#1A2B", "*12:const a = 1;", " 13:const b = 2;"].join("\n"),
    );
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.path).toBe("src/app.ts");
    expect(parsed.hits[0]!.lines.map((row) => row.line)).toEqual([12, 13]);
  });

  it("treats a standalone [path#TAG] line as a file header, not a notice", () => {
    const parsed = parseGrepOutput(
      ["[src/main/index.ts#0A1B]", "*12:import x from 'y';", " 13:const a = 1;"].join(
        "\n",
      ),
    );
    expect(parsed.notices).toEqual([]);
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]!.path).toBe("src/main/index.ts");
    expect(parsed.hits[0]!.lines.map((row) => row.line)).toEqual([12, 13]);
    expect(parsed.matchCount).toBe(1);
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

  // omp 的路径已经相对工作区，再拼搜索目录会重复。
  it("passes omp paths through untouched", () => {
    expect(
      grepOpenPath(
        "src/renderer/src/components",
        "src/renderer/src/components/ToolCallCard.module.css",
        "workspace",
      ),
    ).toBe("src/renderer/src/components/ToolCallCard.module.css");
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
    expect(toolCardExpandable(card)).toBe(true);
  });

  it("drops the body affordance when there is nothing to show", () => {
    const card = parseToolCard("grep", { pattern: "x" }, undefined);
    if (card.kind !== "grep") throw new Error("expected grep card");
    expect(toolCardExpandable(card)).toBe(false);
  });

  // omp 走同一张卡片：输出格式不同，但必须解析出可高亮的命中行。
  it("renders omp grep results as structured hits", () => {
    const card = parseToolCard(
      "grep",
      { pattern: "toolCall", path: "src/renderer/src/components/ToolCallCard.module.css" },
      {
        content: [
          {
            type: "text",
            text: ["*2|.toolCall {", " 3|  width: 100%;", "*10|.toolCall.askUserMuted {"].join("\n"),
          },
        ],
      },
    );
    if (card.kind !== "grep") throw new Error("expected grep card");
    expect(card.searchPath).toBe("src/renderer/src/components/ToolCallCard.module.css");
    expect(card.hits).toHaveLength(1);
    expect(card.hits[0]!.lines.map((row) => row.line)).toEqual([2, 3, 10]);
    expect(card.matchCount).toBe(2);
    expect(toolCardExpandable(card)).toBe(true);
  });
});
