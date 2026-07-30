import { describe, expect, it } from "vitest";
import { heuristicSessionTitle } from "../../src/renderer/src/utils/session-title";

describe("heuristicSessionTitle", () => {
  it("trims and truncates long titles", () => {
    const long = "a".repeat(80);
    expect(heuristicSessionTitle(long).endsWith("…")).toBe(true);
    expect(heuristicSessionTitle(long).length).toBeLessThanOrEqual(42);
  });

  it("strips browser citation preamble", () => {
    const raw = "Context from browser selection:\n\n### Citation\n\n---\n\nfix the login button";
    expect(heuristicSessionTitle(raw)).toBe("fix the login button");
  });

  it("strips 内置浏览器 header with selection context", () => {
    const raw =
      "# 内置浏览器 (Built-in browser)\n\nContext from browser selection:\n\n### Citation\n\n---\n\n点一下登录";
    expect(heuristicSessionTitle(raw)).toBe("点一下登录");
  });

  it("returns empty for blank input", () => {
    expect(heuristicSessionTitle("   ")).toBe("");
  });
});
