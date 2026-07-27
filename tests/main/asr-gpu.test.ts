import { describe, expect, it } from "vitest";
import {
  detectAsrGpuBackend,
  detectAsrGpuInfo,
  isAsrNativeCrashExitCode,
  nvidiaSupportsBundledCuda,
  parseAsrExitCode,
  parseNvidiaComputeCaps,
} from "../../src/main/asr-gpu";

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

describe("parseNvidiaComputeCaps", () => {
  it("parses csv noheader lines", () => {
    expect(parseNvidiaComputeCaps("8.6\n7.5\n")).toEqual([8.6, 7.5]);
    expect(parseNvidiaComputeCaps("6.1")).toEqual([6.1]);
    expect(parseNvidiaComputeCaps("")).toEqual([]);
  });
});

describe("nvidiaSupportsBundledCuda", () => {
  it("requires Turing+ when caps are known", () => {
    expect(nvidiaSupportsBundledCuda([])).toBe(true);
    expect(nvidiaSupportsBundledCuda([8.6])).toBe(true);
    expect(nvidiaSupportsBundledCuda([7.5])).toBe(true);
    expect(nvidiaSupportsBundledCuda([6.1])).toBe(false);
    expect(nvidiaSupportsBundledCuda([6.1, 8.9])).toBe(true);
  });
});

describe("isAsrNativeCrashExitCode", () => {
  it("detects Windows access violation and DLL failures", () => {
    expect(isAsrNativeCrashExitCode(3221225477)).toBe(true); // 0xC0000005
    expect(isAsrNativeCrashExitCode(0xc0000005)).toBe(true);
    expect(isAsrNativeCrashExitCode(3221225781)).toBe(true); // DLL not found
    expect(isAsrNativeCrashExitCode(1)).toBe(false);
    expect(isAsrNativeCrashExitCode(null)).toBe(false);
  });
});

describe("parseAsrExitCode", () => {
  it("extracts code from CrispASR exit messages", () => {
    expect(parseAsrExitCode("ASR exited with code 3221225477")).toBe(3221225477);
    expect(parseAsrExitCode("ASR stream exited with code 1")).toBe(1);
    expect(parseAsrExitCode("nope")).toBeNull();
  });
});
