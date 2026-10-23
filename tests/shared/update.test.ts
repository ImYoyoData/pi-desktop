import { describe, expect, it } from "vitest";
import {
	compareVersions,
	isNewerVersion,
	matchUpdateAsset,
	parseSemver,
	safeAssetFileName,
} from "../../src/shared/update";

describe("update helpers", () => {
  it("parses and compares semver", () => {
    expect(parseSemver("v0.0.3")).toEqual([0, 0, 3]);
    expect(isNewerVersion("0.0.4", "0.0.3")).toBe(true);
    expect(isNewerVersion("0.0.3", "0.0.3")).toBe(false);
    expect(isNewerVersion("0.0.2", "0.0.3")).toBe(false);
    expect(isNewerVersion("v1.0.0", "0.9.9")).toBe(true);
  });

  it("orders prerelease versions", () => {
    expect(isNewerVersion("0.3.6-rc.2", "0.3.6-rc.1")).toBe(true);
    expect(isNewerVersion("0.3.6-rc.1", "0.3.6-rc.2")).toBe(false);
    expect(isNewerVersion("0.3.6", "0.3.6-rc.2")).toBe(true);
    expect(isNewerVersion("0.3.6-rc.2", "0.3.6")).toBe(false);
    expect(isNewerVersion("0.3.7-rc.1", "0.3.6")).toBe(true);
  });

  it("compares versions symmetrically", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  it("matches installer assets by platform and arch", () => {
    expect(matchUpdateAsset("Pi Desktop-1.0.0-win-x64-setup.exe", "win32", "x64")).toBe(true);
    expect(matchUpdateAsset("Pi Desktop-1.0.0-win-arm64-setup.exe", "win32", "arm64")).toBe(true);
    expect(matchUpdateAsset("Pi Desktop-1.0.0-mac-arm64.dmg", "darwin", "arm64")).toBe(true);
    expect(matchUpdateAsset("Pi Desktop-1.0.0-mac-x64.dmg", "darwin", "x64")).toBe(true);
    expect(matchUpdateAsset("Pi Desktop-1.0.0-linux-x64.AppImage", "linux", "x64")).toBe(true);
  });

  it("rejects assets of other platforms or arches", () => {
    expect(matchUpdateAsset("Pi Desktop-1.0.0-win-x64-setup.exe", "win32", "arm64")).toBe(false);
    expect(matchUpdateAsset("Pi Desktop-1.0.0-mac-arm64.dmg", "win32", "x64")).toBe(false);
    expect(matchUpdateAsset("Pi Desktop-1.0.0-win-x64-setup.exe", "freebsd", "x64")).toBe(false);
  });

  it("keeps only the file name of remote assets", () => {
    expect(safeAssetFileName("Pi-Desktop-1.0.0-win-x64-setup.exe")).toBe(
      "Pi-Desktop-1.0.0-win-x64-setup.exe",
    );
    expect(safeAssetFileName("../../evil.exe")).toBe("evil.exe");
    expect(safeAssetFileName("..\\..\\windows\\system32\\evil.exe")).toBe("evil.exe");
    expect(safeAssetFileName("dir/sub/name.exe")).toBe("name.exe");
    expect(safeAssetFileName("")).toBe("");
  });
});
