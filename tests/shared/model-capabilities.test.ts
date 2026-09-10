import { describe, expect, it } from "vitest";
import {
  inferModelCapabilities,
  type ModelCapabilities,
} from "../../src/shared/model-metadata";

function caps(id: string, reported?: { reasoning?: boolean; vision?: boolean }): ModelCapabilities {
  return inferModelCapabilities(id, reported);
}

describe("inferModelCapabilities — reasoning", () => {
  it("detects current reasoning families", () => {
    for (const id of [
      "claude-opus-5",
      "claude-sonnet-5",
      "claude-3-7-sonnet",
      "claude-haiku-4-5",
      "gpt-5.5",
      "gpt-5-codex",
      "o3",
      "o4-mini",
      "gemini-2.5-flash",
      "gemini-3.6-flash",
      "deepseek-v4-pro",
      "deepseek-r1",
      "moonshotai/Kimi-K3",
      "kimi-k2.7-code",
      "zai-org/GLM-5.3",
      "glm-4.6",
      "qwen3.7-max",
      "MiniMax-M3",
      "xai/grok-4.6",
      "stepfun/Step-3.7-Flash",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "xiaomi/mimo-v2.5-pro",
    ]) {
      expect(caps(id).reasoning, id).toBe(true);
    }
  });

  it("does not flag plain non-reasoning models", () => {
    for (const id of [
      "llama-3.1:8b",
      "qwen2.5-coder:7b",
      "gpt-4o",
      "gpt-4-turbo",
      "mistral-large-latest",
      "claude-3-5-sonnet-20240620",
      "gemini-1.5-pro",
    ]) {
      expect(caps(id).reasoning, id).toBe(false);
    }
  });

  it("honours an explicit opt-in marker in the id", () => {
    expect(caps("some-model-thinking").reasoning).toBe(true);
    expect(caps("vendor/reasoner-1").reasoning).toBe(true);
  });
});

describe("inferModelCapabilities — vision", () => {
  it("detects vision families", () => {
    for (const id of [
      "claude-sonnet-5",
      "claude-3-5-sonnet",
      "gpt-4o",
      "gpt-5.5",
      "gemini-3.8-flash",
      "qwen2.5-vl-72b",
      "glm-4.6v",
      "llama-3.2-11b-vision",
      "pixtral-12b",
      "grok-4.6",
      "deepseek-v4-flash-vision-exp",
      "step-1v-8k",
      "internvl2-8b",
      "minicpm-v-2.6",
    ]) {
      expect(caps(id).vision, id).toBe(true);
    }
  });

  it("does not flag text-only models", () => {
    for (const id of ["llama-3.1:8b", "qwen2.5-coder:7b", "deepseek-v4-flash", "glm-5.3"]) {
      expect(caps(id).vision, id).toBe(false);
    }
  });

  it("matches the deepseek vision preview id used in the wild", () => {
    const id = "deepseek/deepseek-v4-flash-vision-experimental-preview-2026-09-01";
    expect(caps(id)).toMatchObject({ reasoning: true, vision: true });
  });
});

describe("inferModelCapabilities — provider precedence", () => {
  it("prefers what the provider reported over the id guess", () => {
    // A provider that says a gpt-5 model has no vision wins over the heuristic.
    expect(caps("gpt-5.5", { vision: false })).toMatchObject({ vision: false, source: "reported" });
    // …and one that reports vision on an unfamiliar id is trusted.
    expect(caps("vendor/unknown-thing", { vision: true })).toMatchObject({
      vision: true,
      source: "reported",
    });
  });

  it("reports the inference source", () => {
    expect(caps("claude-opus-5").source).toBe("inferred");
    expect(caps("gpt-5.5", { reasoning: false }).source).toBe("reported");
    expect(caps("totally-unknown-model").source).toBe("unknown");
    expect(caps("").source).toBe("unknown");
  });

  it("treats a non-boolean report as absent", () => {
    const reported = { reasoning: undefined, vision: undefined };
    expect(caps("claude-opus-5", reported)).toMatchObject({ reasoning: true, vision: true });
  });

  it("is case-insensitive and tolerates empty input", () => {
    expect(caps("CLAUDE-OPUS-5").reasoning).toBe(true);
    expect(caps("   ").reasoning).toBe(false);
    expect(caps("").vision).toBe(false);
  });
});
