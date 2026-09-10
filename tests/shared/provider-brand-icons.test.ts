import { describe, expect, it } from "vitest";
import {
  brandGlyph,
  resolveBrandIconKey,
  resolveBrandVisual,
} from "../../src/shared/provider-brand-icons";
import { PROVIDER_ICON_GLYPHS } from "../../src/shared/provider-icon-glyphs";

const BRANDED_IDS = [
  // Pi SDK provider ids
  "anthropic",
  "openai",
  "openai-codex",
  "google",
  "google-vertex",
  "deepseek",
  "groq",
  "mistral",
  "moonshotai",
  "moonshotai-cn",
  "kimi-coding",
  "minimax",
  "minimax-cn",
  "xai",
  "xiaomi",
  "xiaomi-token-plan-cn",
  "zai",
  "zai-coding-cn",
  "qwen-token-plan-cn",
  "openrouter",
  "github-copilot",
  "azure-openai-responses",
  "amazon-bedrock",
  "cerebras",
  "nvidia",
  "together",
  "huggingface",
  "fireworks",
  "baseten",
  "vercel-ai-gateway",
  "cloudflare-workers-ai",
  "cloudflare-ai-gateway",
  "ant-ling",
  // OpenCode (Zen / Go) — requested explicitly
  "opencode",
  "opencode-go",
  // Our catalog
  "commandcode",
  "longcat",
  "dashscope",
  "doubao",
  "zhipu",
  "siliconflow",
  "stepfun",
  "hunyuan",
  "baidu-qianfan",
  "modelscope",
  "ppio",
  "sensenova",
  "giteeai",
  "iflytek",
  "ollama",
  "lmstudio",
  "vllm",
  "openai-compatible",
];

describe("provider brand icons", () => {
  it("resolves a brand icon for every platform we ship", () => {
    for (const id of BRANDED_IDS) {
      const visual = resolveBrandVisual(id);
      expect(visual, `no brand visual for ${id}`).toBeTruthy();
      expect(visual?.bg, id).toMatch(/^#[0-9a-f]{6}$/iu);
      expect(visual?.fg, id).toMatch(/^#[0-9a-f]{6}$/iu);
    }
  });

  it("has glyph path data for every brand visual", () => {
    for (const id of BRANDED_IDS) {
      const visual = resolveBrandVisual(id);
      const glyph = visual ? brandGlyph(visual.glyph) : null;
      expect(glyph, `no glyph for ${id}`).toBeTruthy();
      expect(glyph?.paths.length ?? 0).toBeGreaterThan(0);
      expect(glyph?.viewBox).toMatch(/^[\d.\s-]+$/u);
    }
  });

  it("maps the requested platforms to their own marks", () => {
    expect(resolveBrandIconKey("commandcode")).toBe("commandcode");
    expect(resolveBrandIconKey("command-code")).toBe("commandcode");
    expect(resolveBrandIconKey("opencode")).toBe("opencode");
    expect(resolveBrandIconKey("opencode-go")).toBe("opencode");
    expect(resolveBrandIconKey("zai-coding-cn")).toBe("zai");
    expect(resolveBrandIconKey("moonshotai-cn")).toBe("moonshot");
    expect(resolveBrandIconKey("cloudflare-workers-ai")).toBe("workersai");
  });

  it("falls back to substring aliases for derived provider ids", () => {
    expect(resolveBrandIconKey("my-opencode-proxy")).toBe("opencode");
    expect(resolveBrandIconKey("xiaomi-token-plan-ams")).toBe("xiaomimimo");
    expect(resolveBrandIconKey("qwen-token-plan-individual")).toBe("qwen");
    // Leftmost match wins: the platform, not the wire protocol in the suffix.
    expect(resolveBrandIconKey("deepseek-anthropic")).toBe("deepseek");
    expect(resolveBrandIconKey("longcat-anthropic")).toBe("longcat");
  });

  it("returns null for unknown products so the letter chip is used", () => {
    expect(resolveBrandIconKey("totally-unknown-vendor")).toBeNull();
    expect(resolveBrandVisual("")).toBeNull();
  });

  it("keeps Command Code a square 700-unit mark", () => {
    const glyph = brandGlyph("commandcode");
    expect(glyph?.viewBox).toBe("0 0 700 700");
    expect(glyph?.transform).toBeTruthy();
  });

  it("ships only single-colour glyph paths", () => {
    for (const [key, glyph] of Object.entries(PROVIDER_ICON_GLYPHS)) {
      for (const path of glyph.paths) {
        expect(path.fill, `${key} should be currentColor`).toBeUndefined();
      }
    }
  });
});
