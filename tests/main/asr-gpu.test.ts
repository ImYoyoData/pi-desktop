import { describe, expect, it } from "vitest";
import { detectAsrGpuBackend, detectAsrGpuInfo } from "../../src/main/asr-gpu";

describe("detectAsrGpuInfo", () => {
  it("returns backend, device label, and kind", () => {
    const info = detectAsrGpuInfo();
    expect(["cuda", "vulkan", "metal", "cpu"]).toContain(info.backend);
    expect(["discrete", "integrated", "metal", "cpu"]).toContain(info.kind);
    expect(info.deviceLabel.length).toBeGreaterThan(0);
    expect(detectAsrGpuBackend()).toBe(info.backend);
    if (process.platform === "darwin") {
      expect(info.backend).toBe("metal");
      expect(info.kind).toBe("metal");
    }
  });
});
