import { describe, expect, it } from "vitest";
import { sanitizeTerminalCommandLabel, truncateTabLabel } from "../../src/shared/tab-label";

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
