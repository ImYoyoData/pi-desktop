import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const level = /^\d+$/.test(argv[0] ?? "") ? argv.shift() : null;
const env = { ...process.env };
if (level) env.ELECTRON_BUILDER_COMPRESSION_LEVEL = level;

const status =
  spawnSync(
    process.execPath,
    [require.resolve("electron-builder/cli.js"), ...argv, "--publish", "never"],
    { cwd: root, stdio: "inherit", env },
  ).status ?? 1;

process.exit(status);
