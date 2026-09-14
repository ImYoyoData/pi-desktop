import { describe, expect, it } from "vitest";
import {
  cloudflaredCandidates,
  cloudflaredFileName,
  isSpawnablePath,
  pickCloudflaredPath,
  type BinaryLayout,
} from "../../src/shared/cloudflared-path";

/**
 * Regression guards for the packaged-app binary lookup.
 *
 * These exact situations shipped broken: a packaged build "found" a path inside
 * app.asar (Electron makes those report as existing) and then failed to spawn it,
 * and the per-arch directory turned out to be flattened by electron-builder.
 */
const VERSION = "2026.9.1";

/** Pretend these paths exist on disk. */
function fakeFs(files: Record<string, number>) {
  return (p: string) => {
    const size = files[p];
    if (size === undefined) throw new Error("ENOENT");
    return { isFile: () => true, size };
  };
}

const WINDOWS_PACKAGED: BinaryLayout = {
  platform: "win32",
  arch: "x64",
  resourcesPath: "C:\\App\\resources",
  execPath: "C:\\App\\PiDesktop.exe",
  bundleDir: "C:\\App\\resources\\app.asar\\out\\main",
};

describe("isSpawnablePath", () => {
  it("rejects paths inside an asar archive", () => {
    const stat = fakeFs({
      "C:\\App\\resources\\app.asar\\resources\\cloudflared\\2026.9.1\\cloudflared.exe": 54_976_432,
    });
    expect(
      isSpawnablePath("C:\\App\\resources\\app.asar\\resources\\cloudflared\\2026.9.1\\cloudflared.exe", stat),
    ).toBe(false);
  });

  it("rejects asar.unpacked copies too (they are not the binary either)", () => {
    const stat = fakeFs({ "C:\\App\\resources\\app.asar.unpacked\\cloudflared.exe": 54_976_432 });
    expect(isSpawnablePath("C:\\App\\resources\\app.asar.unpacked\\cloudflared.exe", stat)).toBe(false);
  });

  it("accepts a real file outside the archive", () => {
    const p = "C:\\App\\resources\\resources\\cloudflared\\2026.9.1\\cloudflared.exe";
    expect(isSpawnablePath(p, fakeFs({ [p]: 54_976_432 }))).toBe(true);
  });

  it("rejects a truncated download", () => {
    const p = "C:\\App\\cloudflared.exe";
    expect(isSpawnablePath(p, fakeFs({ [p]: 1024 }))).toBe(false);
  });

  it("rejects missing files and empty input", () => {
    expect(isSpawnablePath("C:\\nope.exe", fakeFs({}))).toBe(false);
    expect(isSpawnablePath("", fakeFs({}))).toBe(false);
  });
});

describe("pickCloudflaredPath", () => {
  it("finds the per-arch layout that our prefetch writes", () => {
    const p = "C:\\App\\resources\\resources\\cloudflared\\2026.9.1\\x64\\cloudflared.exe";
    expect(pickCloudflaredPath(VERSION, WINDOWS_PACKAGED, fakeFs({ [p]: 54_976_432 }))).toBe(p);
  });

  it("also finds the FLATTENED layout electron-builder produces", () => {
    // electron-builder drops the ${arch} directory when copying extraResources.
    const p = "C:\\App\\resources\\resources\\cloudflared\\2026.9.1\\cloudflared.exe";
    expect(pickCloudflaredPath(VERSION, WINDOWS_PACKAGED, fakeFs({ [p]: 54_976_432 }))).toBe(p);
  });

  it("never returns a path inside app.asar, even when only that exists", () => {
    const inside = "C:\\App\\resources\\app.asar\\resources\\cloudflared\\2026.9.1\\cloudflared.exe";
    expect(pickCloudflaredPath(VERSION, WINDOWS_PACKAGED, fakeFs({ [inside]: 54_976_432 }))).toBeNull();
  });

  it("falls back to the userData copy when the bundled one is absent", () => {
    const userData = "C:\\App\\resources\\cloudflared\\cloudflared.exe";
    expect(pickCloudflaredPath(VERSION, WINDOWS_PACKAGED, fakeFs({ [userData]: 54_976_432 }))).toBeNull();
    // (userData resolution lives in cloudflared-binary.ts; this asserts the
    // bundled lookup itself stays focused on resources/.)
  });

  it("finds the repo checkout in dev (walking up from out/main)", () => {
    const layout: BinaryLayout = {
      platform: "win32",
      arch: "x64",
      resourcesPath: "D:\\repo\\node_modules\\electron\\dist\\resources",
      execPath: "D:\\repo\\node_modules\\electron\\dist\\electron.exe",
      bundleDir: "D:\\repo\\out\\main",
    };
    const p = "D:\\repo\\resources\\cloudflared\\2026.9.1\\x64\\cloudflared.exe";
    expect(pickCloudflaredPath(VERSION, layout, fakeFs({ [p]: 54_976_432 }))).toBe(p);
  });
});

describe("cloudflaredCandidates", () => {
  it("lists both layouts under both packing roots before the walk-up roots", () => {
    const list = cloudflaredCandidates(VERSION, WINDOWS_PACKAGED);
    const resourcesRoot = "C:\\App\\resources";
    expect(list[0]).toBe(`${resourcesRoot}\\resources\\cloudflared\\${VERSION}\\x64\\cloudflared.exe`);
    expect(list[1]).toBe(`${resourcesRoot}\\resources\\cloudflared\\${VERSION}\\cloudflared.exe`);
    expect(list).toContain("C:\\App\\resources\\cloudflared\\2026.9.1\\x64\\cloudflared.exe");
  });

  it("has no duplicates", () => {
    const list = cloudflaredCandidates(VERSION, WINDOWS_PACKAGED);
    expect(new Set(list).size).toBe(list.length);
  });

  it("uses cloudflared.exe only on Windows", () => {
    expect(cloudflaredFileName("win32")).toBe("cloudflared.exe");
    expect(cloudflaredFileName("darwin")).toBe("cloudflared");
    expect(cloudflaredFileName("linux")).toBe("cloudflared");
  });
});
