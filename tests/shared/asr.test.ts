import { describe, expect, it } from "vitest";
import { resolveAsrBinaryAsset, ASR_DISK_MB, ASR_RAM_MB } from "../../src/shared/asr";

describe("asr config", () => {
  it("exposes install size hints", () => {
    expect(ASR_DISK_MB).toBeGreaterThan(100);
    expect(ASR_RAM_MB).toBeGreaterThan(100);
  });

  it("resolves windows and mac binaries", () => {
    expect(resolveAsrBinaryAsset("win32", "x64")?.archive).toBe("zip");
    expect(resolveAsrBinaryAsset("darwin", "arm64")?.archive).toBe("tar.gz");
    expect(resolveAsrBinaryAsset("linux", "x64")?.url).toContain("linux-x86_64");
  });
});
