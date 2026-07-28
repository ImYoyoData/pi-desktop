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

  it("strips focus-in CSI fragments without ESC ([I)", () => {
    expect(sanitizeTerminalCommandLabel("[I[Ipnpm dev")).toBe("pnpm dev");
    expect(sanitizeTerminalCommandLabel("\x1b[Ipnpm dev")).toBe("pnpm dev");
  });

  it("keeps a clean first command without path/quotes/chain noise", () => {
    expect(sanitizeTerminalCommandLabel('  "C:\\\\Tools\\\\npm.cmd" run build && echo done  ')).toBe(
      "npm run build",
    );
    expect(sanitizeTerminalCommandLabel("./gradlew assembleDebug | tee log")).toBe(
      "gradlew assembleDebug",
    );
    expect(sanitizeTerminalCommandLabel("$ git status")).toBe("git status");
    expect(sanitizeTerminalCommandLabel("npm test; exit")).toBe("npm test");
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
