#!/usr/bin/env node
/**
 * Download dugite's embedded Git through a China-reachable mirror/proxy of
 * GitHub release assets.
 *
 * dugite's official download URL points at github.com, which is often
 * unreachable from mainland China. This helper tries a list of popular
 * gh-proxy style prefixes in order, and finally falls back to the official
 * GitHub URL (handy when a VPN is on).
 *
 * Safety: every attempt still goes through scripts/ensure-dugite-git.mjs with
 * DUGITE_GIT_URL set, and dugite itself verifies the archive against the
 * official sha256 checksum from embedded-git.json — a mirror can never inject
 * different bytes.
 *
 * Usage:
 *   node scripts/download-dugite-git-cn.mjs
 *
 * Or, to use your own working mirror manually (PowerShell):
 *   $env:DUGITE_GIT_URL="https://your-mirror/<full .tar.gz URL>"
 *   node scripts/ensure-dugite-git.mjs
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ensureScript = path.join(root, "scripts", "ensure-dugite-git.mjs");

// gh-proxy style mirrors of GitHub release assets. These services come and go,
// so they are only tried in order; any of them failing falls through to the
// next one. Add/remove prefixes freely.
const MIRROR_PREFIXES = [
  "https://ghfast.top/",
  "https://gh-proxy.com/",
  "https://ghproxy.net/",
  "https://gh.llkk.cc/",
];

let dugiteRoot;
try {
  dugiteRoot = path.dirname(require.resolve("dugite/package.json"));
} catch {
  console.error("[dugite-cn] dugite is not installed — run pnpm install first");
  process.exit(2);
}

const key = `${process.platform}-${process.arch}`;
let officialUrl;
try {
  const entries = JSON.parse(
    fs.readFileSync(
      path.join(dugiteRoot, "script", "embedded-git.json"),
      "utf8",
    ),
  );
  const entry = entries[key];
  if (!entry) {
    console.error(`[dugite-cn] no embedded-git.json entry for "${key}"`);
    process.exit(2);
  }
  officialUrl = entry.url;
} catch (err) {
  console.error(`[dugite-cn] cannot read dugite embedded-git.json: ${err.message}`);
  process.exit(2);
}

// Already in place? Nothing to do.
const gitExe = path.join(dugiteRoot, "git", "cmd", "git.exe");
if (process.platform === "win32" && fs.existsSync(gitExe)) {
  console.log(`[dugite-cn] embedded Git already present: ${gitExe}`);
  process.exit(0);
}

function runOnce(label, url) {
  console.log(`\n[dugite-cn] trying ${label}: ${url}`);
  const env = { ...process.env };
  if (url) env.DUGITE_GIT_URL = url;
  const res = spawnSync(process.execPath, [ensureScript], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (res.error) {
    console.error(`[dugite-cn] failed to run ensure script: ${res.error.message}`);
    return false;
  }
  if (res.status !== 0) return false;
  if (!fs.existsSync(gitExe)) {
    console.warn(`[dugite-cn] ${label} claimed success but ${gitExe} is missing`);
    return false;
  }
  return true;
}

const attempts = [
  ...MIRROR_PREFIXES.map((p, i) => [
    `mirror #${i + 1} (${p})`,
    `${p}${officialUrl}`,
  ]),
  ["official GitHub (VPN)", null],
];

for (const [label, url] of attempts) {
  if (runOnce(label, url)) {
    console.log(`\n[dugite-cn] DONE — embedded Git downloaded via ${label}`);
    process.exit(0);
  }
}

console.error(
  "\n[dugite-cn] all mirrors failed. Options:\n" +
    "  1. Turn your VPN on and re-run:      node scripts/download-dugite-git-cn.mjs\n" +
    "  2. Use a mirror that works for you:\n" +
    "       $env:DUGITE_GIT_URL=\"<full mirror .tar.gz URL>\"\n" +
    "       node scripts/ensure-dugite-git.mjs",
);
process.exit(1);
