import { describe, expect, it } from "vitest";
import {
  browserResultHead,
  mcpServerName,
  toolFamily,
  toolResultCount,
} from "../../src/renderer/src/utils/tool-family";
import { splitTrailingNotice } from "../../src/renderer/src/utils/structured-text";

describe("toolFamily", () => {
  it("routes each builtin family", () => {
    expect(toolFamily("browser_snapshot")).toBe("browser");
    expect(toolFamily("mcp__files__list_directory")).toBe("mcp");
    expect(toolFamily("tool_search")).toBe("toolSearch");
    expect(toolFamily("codemode")).toBe("codemode");
    expect(toolFamily("ls")).toBe("pathList");
    expect(toolFamily("find")).toBe("pathList");
    expect(toolFamily("some_extension_tool")).toBe("generic");
  });
});

describe("toolResultCount", () => {
  it("counts path list entries", () => {
    expect(toolResultCount("find", "src/a.ts\nsrc/b.ts\n", null)).toEqual({
      count: 2,
      unit: "items",
    });
  });

  it("counts browser elements from the JSON payload", () => {
    const text = JSON.stringify({
      tabId: "t1",
      url: "https://example.com",
      title: "Example",
      elements: [{ selector: "#a" }, { selector: "#b" }],
    });
    expect(toolResultCount("browser_snapshot", text, null)).toEqual({
      count: 2,
      unit: "elements",
    });
  });

  it("reads the loaded tool count from tool_search output", () => {
    const text = "Loaded 3 tools. They are available from your next call:\n- a\n- b\n- c";
    expect(toolResultCount("tool_search", text, null)).toEqual({
      count: 3,
      unit: "tools",
    });
  });

  it("returns null when nothing can be counted", () => {
    expect(toolResultCount("custom", "just some text", null)).toBeNull();
  });
});

describe("browserResultHead", () => {
  it("reads url and title", () => {
    expect(browserResultHead({ url: "https://x.test", title: "X" })).toEqual({
      url: "https://x.test",
      title: "X",
    });
  });

  it("ignores non-object payloads", () => {
    expect(browserResultHead("plain")).toEqual({ url: null, title: null });
  });
});

describe("mcpServerName", () => {
  it("splits the server out of an MCP tool name", () => {
    expect(mcpServerName("mcp__files__read_file")).toBe("files");
    expect(mcpServerName("read")).toBeNull();
    expect(mcpServerName("mcp__files")).toBeNull();
  });
});

describe("splitTrailingNotice", () => {
  it("separates the trailing [..] notice", () => {
    const parsed = splitTrailingNotice("a\nb\n\n[1000 results limit reached]");
    expect(parsed.text).toBe("a\nb");
    expect(parsed.notices).toEqual(["1000 results limit reached"]);
  });

  it("leaves text without a notice untouched", () => {
    const parsed = splitTrailingNotice("a\nb");
    expect(parsed.text).toBe("a\nb");
    expect(parsed.notices).toEqual([]);
  });
});
