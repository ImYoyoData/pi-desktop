/**
 * Rasterize build/icon.svg → build/icon.png (1024) for electron-builder.
 * Prefer @resvg/resvg-js; fall back to copying a prebuilt PNG if unavailable.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const svgPath = join(root, "build", "icon.svg");
const pngPath = join(root, "build", "icon.png");

function pngIsFresh() {
  try {
    if (!existsSync(pngPath)) return false;
    return statSync(svgPath).mtimeMs <= statSync(pngPath).mtimeMs;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(svgPath)) {
    console.error("Missing build/icon.svg");
    process.exit(1);
  }

  // Idempotent: icon.png only changes when icon.svg does (saves time on
  // repeated packaging runs, the slow part is electron-builder assembly).
  if (pngIsFresh()) {
    console.log("build/icon.png is up to date; skipping rasterization");
    return;
  }

  try {
    const require = createRequire(import.meta.url);
    const { Resvg } = require("@resvg/resvg-js");
    const svg = readFileSync(svgPath);
    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 1024 },
    });
    const png = resvg.render().asPng();
    writeFileSync(pngPath, png);
    const resourcesPng = join(root, "resources", "icon.png");
    copyFileSync(pngPath, resourcesPng);
    console.log(`Wrote ${pngPath} and ${resourcesPng} (${png.length} bytes)`);
  } catch (err) {
    if (existsSync(pngPath)) {
      console.warn("resvg unavailable; keeping existing build/icon.png");
      console.warn(String(err));
      return;
    }
    // Minimal valid 1×1 PNG is useless for icons — fail loudly in CI.
    console.error("Failed to generate icon.png. Install @resvg/resvg-js and retry.");
    console.error(err);
    process.exit(1);
  }
}

await main();
