#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmrcPath = join(repoRoot, ".npmrc");
const electronInstallPath = join(repoRoot, "node_modules", "electron", "install.js");

/** .npmrc 键 → @electron/get 与 electron-builder 读取的环境变量。 */
const MIRROR_ENV = [
  ["electron_mirror", "ELECTRON_MIRROR"],
  ["electron_custom_dir", "ELECTRON_CUSTOM_DIR"],
  ["electron_builder_binaries_mirror", "ELECTRON_BUILDER_BINARIES_MIRROR"],
];

function readNpmrc(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

/** npm 13 会忽略 .npmrc 的同名键，这里在进程内显式落成环境变量。 */
function mirrorEnv(npmrc) {
  const env = {};
  for (const [key, name] of MIRROR_ENV) {
    const value = npmrc[key];
    if (value) env[name] = value;
  }
  return env;
}

function runElectronInstall() {
  if (!existsSync(electronInstallPath)) {
    console.error(`[install-electron] missing ${electronInstallPath}，请先安装依赖`);
    process.exit(1);
  }
  const npmrc = readNpmrc(npmrcPath);
  const env = { ...process.env };
  for (const [name, value] of Object.entries(mirrorEnv(npmrc))) {
    if (!env[name]) env[name] = value;
  }
  const result = spawnSync(process.execPath, [electronInstallPath], {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

runElectronInstall();
