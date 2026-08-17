import { describe, expect, it } from "vitest";
import { hljsThemeId } from "../../src/renderer/src/utils/hljs-theme";

describe("hljsThemeId", () => {
  it("maps light/dark to github theme ids", () => {
    expect(hljsThemeId("light")).toBe("github");
    expect(hljsThemeId("dark")).toBe("github-dark");
  });
});
