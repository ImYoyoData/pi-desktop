import { describe, expect, it } from "vitest";
import { sanitizeTerminalCommandLabel, truncateTabLabel } from "../../src/shared/tab-label";
import { composerModePreamble, isComposerAgentMode } from "../../src/shared/composer-modes";

describe("truncateTabLabel", () => {
  it("keeps short labels", () => {
    expect(truncateTabLabel("npm test")).toBe("npm test");
  });

  it("truncates long labels", () => {
    const out = truncateTabLabel("a".repeat(40), 24);
    expect(out.length).toBe(24);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("sanitizeTerminalCommandLabel", () => {
  it("strips control sequences", () => {
    expect(sanitizeTerminalCommandLabel("ls\x1b[0m -la")).toBe("ls -la");
  });
});

describe("composerModePreamble", () => {
  it("marks all four modes", () => {
    expect(composerModePreamble("agent")).toContain("[pi-desktop mode: agent]");
    expect(composerModePreamble("ask")).toContain("read-only");
    expect(composerModePreamble("plan")).toContain("do not auto-execute");
    expect(composerModePreamble("task")).toContain("Task mode");
  });

  it("validates mode ids", () => {
    expect(isComposerAgentMode("agent")).toBe(true);
    expect(isComposerAgentMode("auto")).toBe(false);
  });
});
