/**
 * Prepare native modules (node-pty) for Electron — WITHOUT requiring a C++
 * toolchain.
 *
 * node-pty 1.x ships N-API prebuilds in `prebuilds/<platform>-<arch>/`, which
 * are ABI-stable and load fine in Electron. `electron-builder install-app-deps`
 * ignores them and forces a node-gyp rebuild, so `pnpm install` died with
 * "Could not find any Visual Studio installation to use" on machines without
 * VS Build Tools.
 *
 * What we do instead:
 *   1. `build/Release/pty.node` already there            → nothing to do.
 *   2. prebuilds present                                 → materialise them into
 *      `build/Release/` (node-pty's first lookup dir) together with the helper
 *      binaries it spawns at runtime (OpenConsole.exe, conpty.dll, winpty.dll,
 *      winpty-agent.exe, spawn-helper).
 *   3. no prebuild for this platform/arch                → fall back to
 *      `electron-builder install-app-deps`, and only fail hard in CI / when
 *      PI_REQUIRE_NATIVE_REBUILD=1 (a missing terminal must not break install;
 *      the app degrades gracefully — see src/main/terminal-host.ts).
 *
 * Usage:
 *   node scripts/rebuild-native.mjs [--rebuild]
 *
 * Env:
 *   PI_SKIP_NATIVE_REBUILD=1     skip everything
 *   PI_REQUIRE_NATIVE_REBUILD=1  hard-fail instead of warning
 *   --rebuild / PI_FORCE_REBUILD=1  always run install-app-deps
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

const log = (msg) => console.log(`[rebuild-native] ${msg}`);
const warn = (msg) => console.warn(`[rebuild-native] ${msg}`);

const platform = process.env.npm_config_platform || process.platform;
// npm_config_arch is what node-gyp / electron-builder cross builds use.
const argArch = process.argv.slice(2).find((a) => !a.startsWith("--"));
const arch = argArch?.trim() || process.env.npm_config_arch || process.arch;
const forceRebuild =
  process.argv.includes("--rebuild") || process.env.PI_FORCE_REBUILD === "1";
const strict =
  process.env.PI_REQUIRE_NATIVE_REBUILD === "1" ||
  process.env.PI_STRICT_INSTALL === "1" ||
  Boolean(process.env.CI);

if (process.env.PI_SKIP_NATIVE_REBUILD === "1") {
  log("PI_SKIP_NATIVE_REBUILD=1 — skipping native module setup");
  process.exit(0);
}

ensureElectronBinary();

let ptyRoot;
try {
  ptyRoot = path.dirname(require.resolve("node-pty/package.json"));
} catch {
  log("node-pty is not installed — skipping");
  process.exit(0);
}

const releaseDir = path.join(ptyRoot, "build", "Release");
const prebuildDir = path.join(ptyRoot, "prebuilds", `${platform}-${arch}`);

/** Native addons node-pty may load (win32 uses conpty by default, winpty as fallback). */
const requiredAddons = platform === "win32"
  ? ["conpty.node", "pty.node"]
  : ["pty.node"];

const hasAddons = (dir) =>
  fs.existsSync(dir) && requiredAddons.every((f) => fs.existsSync(path.join(dir, f)));

/** Helper executables/DLLs node-pty spawns or LoadLibraries next to its addon. */
const helperNames =
  platform === "win32"
    ? ["OpenConsole.exe", "conpty.dll", "winpty.dll", "winpty-agent.exe"]
    : ["spawn-helper"];

function findFirst(base, name, depth = 5) {
  if (!fs.existsSync(base) || depth < 0) return null;
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    const full = path.join(base, entry.name);
    if (entry.name === name && entry.isFile()) return full;
  }
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const hit = findFirst(path.join(base, entry.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** Read `key = value` out of .npmrc (electron_mirror lives there). */
function readNpmrc(key) {
  try {
    const text = fs.readFileSync(path.join(root, ".npmrc"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim();
    }
  } catch {
    /* no .npmrc */
  }
  return "";
}

/**
 * Electron's own install script is blocked by pnpm >= 10 unless approved, and a
 * stale `ignoredBuilds` record keeps `pnpm install` failing — so make sure the
 * binary exists ourselves and `pnpm dev` can launch regardless.
 */
function ensureElectronBinary() {
  let electronRoot;
  try {
    electronRoot = path.dirname(require.resolve("electron/package.json"));
  } catch {
    return;
  }
  const exe =
    platform === "win32"
      ? path.join(electronRoot, "dist", "electron.exe")
      : platform === "darwin"
        ? path.join(electronRoot, "dist", "Electron.app", "Contents", "MacOS", "Electron")
        : path.join(electronRoot, "dist", "electron");
  if (fs.existsSync(exe)) {
    log(`electron binary present (${path.relative(root, exe)})`);
    return;
  }
  log("electron binary missing — running electron's own install.js");
  const status =
    spawnSync(process.execPath, [path.join(electronRoot, "install.js")], {
      cwd: electronRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_MIRROR: readNpmrc("electron_mirror") || process.env.ELECTRON_MIRROR || "",
        ELECTRON_CUSTOM_DIR: readNpmrc("electron_custom_dir") || "",
      },
    }).status ?? 1;
  if (status !== 0) warn(`electron install.js failed (exit ${status}) — run: pnpm approve-builds`);
}

/** node-pty's own helper layout step (conpty.dll + OpenConsole.exe → build/Release/conpty). */
function runPtyPostInstall() {
  if (platform !== "win32") return;
  const marker = path.join(releaseDir, "conpty", "conpty.dll");
  const script = path.join(ptyRoot, "scripts", "post-install.js");
  if (fs.existsSync(marker) || !fs.existsSync(script)) return;
  log("running node-pty scripts/post-install.js (conpty helper layout)");
  const status = spawnSync(process.execPath, [script], {
    cwd: ptyRoot,
    stdio: "inherit",
    env: { ...process.env, npm_config_arch: arch },
  }).status ?? 1;
  if (status !== 0) warn("node-pty post-install.js failed — falling back to our own copy");
}

function copyHelpers() {
  runPtyPostInstall();
  const thirdParty = path.join(ptyRoot, "third_party");
  for (const name of helperNames) {
    const dest = path.join(releaseDir, name);
    if (fs.existsSync(dest)) continue;
    const src = findFirst(thirdParty, name) ?? findFirst(prebuildDir, name);
    if (!src) {
      warn(`helper "${name}" not found in node-pty/third_party — terminal may fail to spawn`);
      continue;
    }
    fs.copyFileSync(src, dest);
    if (name === "spawn-helper") fs.chmodSync(dest, 0o755);
    log(`copied ${name} ← ${path.relative(root, src)}`);
  }
}

function runInstallAppDeps() {
  const bin = path.join(
    root,
    "node_modules",
    ".bin",
    platform === "win32" ? "electron-builder.cmd" : "electron-builder",
  );
  if (fs.existsSync(bin)) {
    log(`running: ${path.relative(root, bin)} install-app-deps`);
    return (
      spawnSync(bin, ["install-app-deps"], {
        cwd: root,
        stdio: "inherit",
        shell: platform === "win32",
      }).status ?? 1
    );
  }
  log("electron-builder bin not found — trying npx");
  return (
    spawnSync("npx", ["--yes", "electron-builder", "install-app-deps"], {
      cwd: root,
      stdio: "inherit",
      shell: platform === "win32",
    }).status ?? 1
  );
}

// Cross-arch packaging (e.g. arm64 NSIS from an x64 host): an existing
// build/Release belongs to the *host* arch, so it must not be trusted.
const sameArchAsHost = !argArch || argArch === process.arch;

if (!forceRebuild && sameArchAsHost && hasAddons(releaseDir)) {
  copyHelpers();
  log(`node-pty build/Release already populated (${platform}-${arch}) — skipping rebuild`);
  process.exit(0);
}

if (!forceRebuild && hasAddons(prebuildDir)) {
  fs.mkdirSync(releaseDir, { recursive: true });
  for (const file of fs.readdirSync(prebuildDir)) {
    const src = path.join(prebuildDir, file);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(releaseDir, file));
  }
  copyHelpers();
  log(
    `using node-pty N-API prebuilds (${platform}-${arch}) — no Visual Studio needed. ` +
      `Force a real rebuild with: npm run native:rebuild`,
  );
  process.exit(0);
}

warn(
  `no usable node-pty binary for ${platform}-${arch} ` +
    `(looked in ${path.relative(root, releaseDir)} and ${path.relative(root, prebuildDir)})`,
);

const status = runInstallAppDeps();
if (status === 0) {
  log("ok");
  process.exit(0);
}

console.error(
  `[rebuild-native] install-app-deps failed (exit ${status}).\n` +
    `  Windows: install the C++ toolchain —\n` +
    `    winget install -e --id Microsoft.VisualStudio.2022.BuildTools --override ` +
    `"--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"\n` +
    `  or run: npm config set msvs_version 2022 && npm run native:rebuild\n` +
    `  The app still starts; only the Terminal tab is disabled until node-pty loads.`,
);
process.exit(strict ? status : 0);
