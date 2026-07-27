import { describe, expect, it } from "vitest";
import {
  resolveAsrBinaryAsset,
  ASR_DISK_MB,
  ASR_RAM_MB,
  ASR_MODEL_URLS,
  ASR_MODEL_FILENAME,
  normalizeAsrModelUrl,
  assertAsrGgufPath,
  collapseAsrRepetition,
  scrubAsrHallucination,
} from "../../src/shared/asr";

describe("asr config", () => {
  it("exposes install size hints", () => {
    expect(ASR_DISK_MB).toBeGreaterThan(100);
    expect(ASR_RAM_MB).toBeGreaterThan(100);
  });

  it("resolves windows GPU backends and mac metal", () => {
    expect(resolveAsrBinaryAsset("win32", "x64", "cpu")?.url).toContain("cpu.zip");
    expect(resolveAsrBinaryAsset("win32", "x64", "cuda")?.url).toContain("cuda.zip");
    expect(resolveAsrBinaryAsset("win32", "x64", "vulkan")?.url).toContain("vulkan.zip");
    expect(resolveAsrBinaryAsset("darwin", "arm64", "metal")?.archive).toBe("tar.gz");
    expect(resolveAsrBinaryAsset("linux", "x64", "vulkan")?.url).toContain("vulkan");
  });

  it("lists model mirrors with hf-mirror first", () => {
    expect(ASR_MODEL_URLS.length).toBeGreaterThanOrEqual(2);
    expect(ASR_MODEL_URLS[0]).toContain("hf-mirror.com");
    expect(ASR_MODEL_URLS[0]).toContain(ASR_MODEL_FILENAME);
    expect(ASR_MODEL_URLS.some((u) => u.includes("huggingface.co"))).toBe(true);
  });

  it("normalizes custom model URLs", () => {
    expect(normalizeAsrModelUrl(" https://example.com/a.gguf ")).toBe("https://example.com/a.gguf");
    expect(() => normalizeAsrModelUrl("ftp://x")).toThrow(/Invalid/);
    expect(() => normalizeAsrModelUrl("")).toThrow(/Invalid/);
  });

  it("checks local gguf paths", () => {
    expect(() => assertAsrGgufPath("C:\\models\\qwen.gguf")).not.toThrow();
    expect(() => assertAsrGgufPath("model.bin")).toThrow(/gguf/i);
  });
});

describe("asr hallucination scrub", () => {
  it("collapses repeated phrase loops from silence hallucinations", () => {
    expect(collapseAsrRepetition("我覺得".repeat(40))).toBe("我覺得");
    expect(collapseAsrRepetition("今天天气很好".repeat(5))).toBe("今天天气很好");
    expect(collapseAsrRepetition("正常一句话")).toBe("正常一句话");
    expect(collapseAsrRepetition("哈哈哈")).toBe("哈哈哈");
  });

  it("drops classic English silence junk when it is the whole transcript", () => {
    expect(scrubAsrHallucination("Thank you.")).toBe("");
    expect(scrubAsrHallucination("thanks for watching")).toBe("");
    expect(scrubAsrHallucination("请打开设置")).toBe("请打开设置");
  });
});
