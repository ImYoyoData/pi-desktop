import { describe, expect, it } from "vitest";
import {
  detectAsrGpuBackend,
  detectAsrGpuInfo,
  estimateNvidiaComputeFromName,
  isAsrDiagnosticOnlyMessage,
  isAsrNativeCrashExitCode,
  nvidiaSupportsBundledCuda,
  parseAsrExitCode,
  parseNvidiaComputeCaps,
  parseVulkanInfoSummary,
  pickVulkanDeviceIndex,
  resolveAsrGpuPreference,
} from "../../src/main/asr-gpu";

describe("detectAsrGpuInfo", () => {
  it("returns backend, device label, and kind", { timeout: 60000 }, () => {
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

describe("estimateNvidiaComputeFromName", () => {
  it("maps GTX 16 / RTX families to Turing+", () => {
    expect(estimateNvidiaComputeFromName("NVIDIA GeForce GTX 1660 Ti")).toBe(
      7.5,
    );
    expect(estimateNvidiaComputeFromName("NVIDIA GeForce RTX 3060")).toBe(8.6);
    expect(estimateNvidiaComputeFromName("NVIDIA GeForce GTX 1060")).toBe(6.1);
    expect(estimateNvidiaComputeFromName("AMD Radeon 780M")).toBeNull();
  });
});

describe("parseVulkanInfoSummary / pickVulkanDeviceIndex", () => {
  const sample = `
GPU0:
        apiVersion         = 1.3.0
        deviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
        deviceName         = NVIDIA GeForce GTX 1660 Ti
GPU1:
        apiVersion         = 1.3.0
        deviceType         = PHYSICAL_DEVICE_TYPE_INTEGRATED_GPU
        deviceName         = AMD Radeon 780M Graphics
`;

  it("parses vulkaninfo summary blocks", () => {
    expect(parseVulkanInfoSummary(sample)).toEqual([
      { index: 0, name: "NVIDIA GeForce GTX 1660 Ti", type: "discrete" },
      { index: 1, name: "AMD Radeon 780M Graphics", type: "integrated" },
    ]);
  });

  it("prefers discrete NVIDIA over AMD iGPU for Vulkan", () => {
    const devices = parseVulkanInfoSummary(sample);
    expect(pickVulkanDeviceIndex(devices)).toBe(0);
  });
});

describe("resolveAsrGpuPreference", () => {
  it("resolves cpu preference", () => {
    expect(resolveAsrGpuPreference("cpu")).toEqual({
      backend: "cpu",
      deviceLabel: "CPU",
      kind: "cpu",
    });
  });

  it("keeps metal preference shape for Apple GPU label", () => {
    // On Windows CI this returns metal only when pref is metal; on darwin auto clamps to metal.
    if (process.platform === "darwin") {
      expect(resolveAsrGpuPreference("auto").backend).toBe("metal");
      expect(resolveAsrGpuPreference("cuda").backend).toBe("metal");
      expect(resolveAsrGpuPreference("vulkan:0").backend).toBe("metal");
    } else {
      expect(resolveAsrGpuPreference("metal")).toEqual({
        backend: "metal",
        deviceLabel: "Apple GPU (Metal)",
        kind: "metal",
      });
    }
  });
});

describe("isAsrDiagnosticOnlyMessage", () => {
  it("detects ggml_vulkan device spam", () => {
    expect(
      isAsrDiagnosticOnlyMessage(
        "ggml_vulkan: Found 1 Vulkan devices:\nggml_vulkan: 0 = NVIDIA GeForce GTX 1660 Ti (NVIDIA) | uma: 0",
      ),
    ).toBe(true);
    expect(isAsrDiagnosticOnlyMessage("ASR exited with code 1")).toBe(false);
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
    expect(parseAsrExitCode("ASR exited with code 3221225477")).toBe(
      3221225477,
    );
    expect(parseAsrExitCode("ASR stream exited with code 1")).toBe(1);
    expect(parseAsrExitCode("nope")).toBeNull();
  });
});
