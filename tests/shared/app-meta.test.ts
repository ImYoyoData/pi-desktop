import { describe, expect, it } from "vitest";
import { APP_GITHUB_API_RELEASES, APP_GITHUB_URL } from "../../src/shared/app-meta";

describe("app-meta", () => {
  it("uses releases list API (not /latest) so prereleases work", () => {
    expect(APP_GITHUB_API_RELEASES).toContain("/releases?");
    expect(APP_GITHUB_API_RELEASES).not.toContain("/latest");
    expect(APP_GITHUB_URL).toContain("ImYoyoData/pi-desktop");
  });
});
