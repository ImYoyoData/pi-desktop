import { describe, expect, it } from "vitest";
import { isNewerVersion, pickReleaseAsset, parseSemver } from "../../src/shared/update";

describe("update helpers", () => {
  it("parses and compares semver", () => {
    expect(parseSemver("v0.0.3")).toEqual([0, 0, 3]);
    expect(isNewerVersion("0.0.4", "0.0.3")).toBe(true);
    expect(isNewerVersion("0.0.3", "0.0.3")).toBe(false);
    expect(isNewerVersion("0.0.2", "0.0.3")).toBe(false);
    expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(true);
  });

  it("picks windows and mac assets by arch", () => {
    const assets = [
      { name: "Pi-Desktop-0.0.4-win-x64-setup.exe", browser_download_url: "u1", size: 1 },
      { name: "Pi-Desktop-0.0.4-win-arm64-setup.exe", browser_download_url: "u2", size: 1 },
      { name: "Pi-Desktop-0.0.4-mac-arm64.dmg", browser_download_url: "u3", size: 1 },
      { name: "Pi-Desktop-0.0.4-mac-x64.dmg", browser_download_url: "u4", size: 1 },
    ];
    expect(pickReleaseAsset(assets, "win32", "x64")?.name).toContain("win-x64-setup");
    expect(pickReleaseAsset(assets, "win32", "arm64")?.name).toContain("win-arm64");
    expect(pickReleaseAsset(assets, "darwin", "arm64")?.name).toContain("mac-arm64");
    expect(pickReleaseAsset(assets, "darwin", "x64")?.name).toContain("mac-x64");
  });
});
