/**
 * Generates src/shared/provider-icon-glyphs.ts from @lobehub/icons-static-svg.
 *
 * The GUI ships a single-colour brand glyph per platform (rendered with
 * `fill: currentColor` inside a brand-coloured tile), so we only need the path
 * data — not the full upstream component library.
 *
 * Usage: node scripts/generate-provider-icons.mjs [--check]
 */
import fs from "node:fs";
import path from "node:path";

const CDN_VERSION = "1.95.0";
const CDN = `https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@${CDN_VERSION}/icons`;
const OUT = path.resolve("src/shared/provider-icon-glyphs.ts");

/** Icon slug → upstream slugs we ship. Keep in sync with provider-brand-icons.ts. */
const SLUGS = [
  "anthropic",
  "antgroup",
  "azureai",
  "baseten",
  "bedrock",
  "cerebras",
  "cloudflare",
  "codex",
  "deepseek",
  "doubao",
  "fireworks",
  "gemini",
  "giteeai",
  "githubcopilot",
  "groq",
  "huggingface",
  "hunyuan",
  "iflytekcloud",
  "kimi",
  "lmstudio",
  "longcat",
  "minimax",
  "mistral",
  "modelscope",
  "moonshot",
  "nvidia",
  "ollama",
  "openai",
  "opencode",
  "openrouter",
  "perplexity",
  "ppio",
  "qwen",
  "sensenova",
  "siliconcloud",
  "skywork",
  "stepfun",
  "together",
  "vercel",
  "vertexai",
  "vllm",
  "wenxin",
  "workersai",
  "xai",
  "xiaomimimo",
  "zai",
  "zhipu",
];

/** LobeHub ships every glyph on a 24×24 grid; a few carry a fill that is not currentColor. */
const FALLBACK_VIEWBOX = "0 0 24 24";

function parseSvg(slug, svg) {
  const viewBox = /viewBox="([^"]+)"/u.exec(svg)?.[1] ?? FALLBACK_VIEWBOX;
  const paths = [...svg.matchAll(/<path\b([^>]*)\/?>/gu)]
    .map((m) => {
      const attrs = m[1] ?? "";
      const d = /\bd="([^"]+)"/u.exec(attrs)?.[1];
      if (!d) return null;
      const fill = /\bfill="([^"]+)"/u.exec(attrs)?.[1];
      // Gradient/duotone glyphs collapse to a single currentColor silhouette.
      return { d: d.trim(), fill: fill && fill !== "currentColor" ? fill : undefined };
    })
    .filter(Boolean);
  if (!paths.length) throw new Error(`${slug}: no <path> found`);
  return { viewBox, paths };
}

async function fetchSlug(slug) {
  const res = await fetch(`${CDN}/${slug}.svg`);
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
  const svg = await res.text();
  return [slug, parseSvg(slug, svg)];
}

async function main() {
  const check = process.argv.includes("--check");
  const entries = [];
  const failed = [];
  // Small concurrency window keeps jsDelivr happy.
  for (let i = 0; i < SLUGS.length; i += 8) {
    const batch = SLUGS.slice(i, i + 8);
    const results = await Promise.all(
      batch.map(async (slug) => {
        try {
          return await fetchSlug(slug);
        } catch (err) {
          failed.push(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
    );
    for (const r of results) if (r) entries.push(r);
  }
  if (failed.length) {
    console.error(`Failed to fetch ${failed.length} icon(s):\n${failed.join("\n")}`);
    process.exitCode = 1;
  }

  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const body = entries
    .map(([slug, glyph]) => {
      const paths = glyph.paths
        .map((p) => `      { d: ${JSON.stringify(p.d)}${p.fill ? `, fill: ${JSON.stringify(p.fill)}` : ""} },`)
        .join("\n");
      return `  ${JSON.stringify(slug)}: {\n    viewBox: ${JSON.stringify(glyph.viewBox)},\n    paths: [\n${paths}\n    ],\n  },`;
    })
    .join("\n");

  const file = `/* eslint-disable */
/**
 * GENERATED FILE — do not edit by hand.
 * Source: @lobehub/icons-static-svg@${CDN_VERSION} (MIT).
 * Regenerate with: node scripts/generate-provider-icons.mjs
 */

export type BrandGlyphPath = { d: string; fill?: string };

export type BrandGlyph = {
  viewBox: string;
  paths: BrandGlyphPath[];
  /** Optional group transform applied to every path (e.g. potrace y-flip). */
  transform?: string;
};

export const PROVIDER_ICON_GLYPHS: Record<string, BrandGlyph> = {
${body}
};
`;
  const banner = "/* eslint-disable */";
  void banner;

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
    if (current !== file) {
      console.error(`${path.relative(process.cwd(), OUT)} is out of date.`);
      process.exitCode = 1;
    }
    return;
  }
  fs.writeFileSync(OUT, file, "utf8");
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${entries.length} glyphs, ${file.length} bytes)`);
}

await main();
