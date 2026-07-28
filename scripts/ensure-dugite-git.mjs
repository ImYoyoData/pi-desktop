/**
 * Ensure dugite's embedded Git matches the target OS arch.
 *
 * dugite's postinstall downloads for `os.arch()` (or `npm_config_arch`).
 * Cross-arch packaging (e.g. macOS x64 DMG on Apple Silicon, Windows arm64
 * NSIS on x64) must re-download before electron-builder packs node_modules.
 *
 * Also run from package.json `postinstall` so local `npm install` /
 * `pnpm install --ignore-scripts` survivors don't silently miss the binary
 * (Changes tab then looks like "not a git repo").
 *
 * Usage:
 *   node scripts/ensure-dugite-git.mjs [arch]
 *   npm_config_arch=x64 node scripts/ensure-dugite-git.mjs
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

let dugiteRoot;
try {
  dugiteRoot = path.dirname(require.resolve("dugite/package.json"));
} catch {
  console.error("[ensure-dugite-git] dugite is not installed — run npm install first");
  process.exit(1);
}

const downloadScript = path.join(dugiteRoot, "script", "download-git.js");

if (!fs.existsSync(downloadScript)) {
  console.error(`[ensure-dugite-git] missing ${downloadScript}`);
  process.exit(1);
}

const argArch = process.argv[2]?.trim();
const arch = argArch || process.env.npm_config_arch || process.arch;
const platform = process.env.npm_config_platform || process.platform;

console.log(
  `[ensure-dugite-git] downloading embedded Git for ${platform}-${arch} → ${dugiteRoot}`,
);

const result = spawnSync(process.execPath, [downloadScript], {
  cwd: dugiteRoot,
  env: {
    ...process.env,
    npm_config_arch: arch,
    npm_config_platform: platform,
  },
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Tar modes are usually preserved; reinforce +x on Unix git binary for packaging.
if (platform !== "win32") {
  const gitBin = path.join(dugiteRoot, "git", "bin", "git");
  if (fs.existsSync(gitBin)) {
    fs.chmodSync(gitBin, 0o755);
    console.log(`[ensure-dugite-git] chmod +x ${gitBin}`);
  } else {
    console.warn(`[ensure-dugite-git] warning: expected binary missing at ${gitBin}`);
  }
}

console.log("[ensure-dugite-git] ok");
