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
 * Hardened behaviour (same CLI as before):
 * - Repeat installs skip the download when a valid embedded Git already exists
 *   for the running platform/arch — fast, and works fully offline.
 * - `DUGITE_GIT_URL` overrides the download URL with a mirror / proxy of the
 *   GitHub release asset. The archive must be byte-identical: it is still
 *   verified against the official sha256 checksum from embedded-git.json.
 * - When no arch argument is given (plain `npm install`) a failed download only
 *   prints a warning and exits 0, so blocked/flaky networks no longer abort the
 *   install. Packaging scripts (`npm run dist:*`) always pass the arch as an
 *   argument, which keeps the download fatal there — a packaged app needs the
 *   embedded Git binary and must not ship without it.
 *
 * Usage:
 *   node scripts/ensure-dugite-git.mjs [arch]
 *   npm_config_arch=x64 node scripts/ensure-dugite-git.mjs
 *   DUGITE_GIT_URL=https://mirror.example/dugite-native-...-windows-x64.tar.gz \
 *     node scripts/ensure-dugite-git.mjs
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

/**
 * dist scripts always pin the arch explicitly, so the embedded Git download is
 * mandatory there. A bare `npm install` (no argument) may degrade gracefully.
 */
const required = Boolean(argArch);

/** The binary dugite expects inside its package for the current platform. */
function embeddedGitBinaryPath() {
  return platform === "win32"
    ? path.join(dugiteRoot, "git", "cmd", "git.exe")
    : path.join(dugiteRoot, "git", "bin", "git");
}

// Plain `npm install` on a machine that already has the right embedded Git:
// nothing to do, and no reason to hit the network.
if (
  !required &&
  arch === process.arch &&
  platform === process.platform &&
  fs.existsSync(embeddedGitBinaryPath())
) {
  console.log(
    `[ensure-dugite-git] embedded Git already present for ${platform}-${arch}, skipping download`,
  );
  process.exit(0);
}

console.log(
  `[ensure-dugite-git] downloading embedded Git for ${platform}-${arch} → ${dugiteRoot}`,
);

// Optional mirror override: DUGITE_GIT_URL replaces the official URL in dugite's
// embedded-git.json for this platform/arch only. The checksum is left untouched,
// so the mirror must serve a byte-identical archive.
const embeddedGitJson = path.join(dugiteRoot, "script", "embedded-git.json");
const mirrorUrl = process.env.DUGITE_GIT_URL?.trim();
let originalEmbeddedJson = null;
if (mirrorUrl) {
  try {
    originalEmbeddedJson = fs.readFileSync(embeddedGitJson, "utf8");
    const entries = JSON.parse(originalEmbeddedJson);
    const key = `${platform}-${arch}`;
    if (!entries[key]) {
      console.error(
        `[ensure-dugite-git] DUGITE_GIT_URL is set but embedded-git.json has no "${key}" entry`,
      );
      process.exit(1);
    }
    entries[key].url = mirrorUrl;
    fs.writeFileSync(embeddedGitJson, JSON.stringify(entries, null, 2));
    console.log(`[ensure-dugite-git] DUGITE_GIT_URL mirror override applied for ${key}`);
  } catch (err) {
    console.error(
      `[ensure-dugite-git] failed to apply DUGITE_GIT_URL override: ${err.message}`,
    );
    process.exit(1);
  }
}

let result;
try {
  result = spawnSync(process.execPath, [downloadScript], {
    cwd: dugiteRoot,
    env: {
      ...process.env,
      npm_config_arch: arch,
      npm_config_platform: platform,
    },
    stdio: "inherit",
  });
} finally {
  // Always restore the pristine embedded-git.json (no dirty node_modules, and
  // no mirror URL leaking into later CI/dist runs).
  if (originalEmbeddedJson !== null) {
    fs.writeFileSync(embeddedGitJson, originalEmbeddedJson);
  }
}

if (result.error) {
  const detail = result.error.message || String(result.error);
  if (required) {
    console.error(`[ensure-dugite-git] failed to run dugite downloader: ${detail}`);
    process.exit(1);
  }
  console.warn(`[ensure-dugite-git] could not run dugite downloader: ${detail}`);
} else if (result.status !== 0) {
  if (required) {
    process.exit(result.status ?? 1);
  }
  console.warn(
    "\n[ensure-dugite-git] WARNING: could not download the embedded Git binary.\n" +
      "  - npm install itself completed; the Git panel needs a git binary, so re-run\n" +
      "    this once the network allows:            node scripts/ensure-dugite-git.mjs\n" +
      "  - or point at a mirror of the GitHub asset (sha256 is still verified):\n" +
      "      DUGITE_GIT_URL=<full mirror .tar.gz URL> node scripts/ensure-dugite-git.mjs\n" +
      "  - or, for local development only, make dugite use an installed Git for Windows\n" +
      "    by setting LOCAL_GIT_DIRECTORY to its install dir (e.g. C:\\Program Files\\Git)\n",
  );
  process.exit(0);
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
