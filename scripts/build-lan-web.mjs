/**
 * Build the LAN web console as a standalone Vue + Naive UI app into
 * out/lan-web (served by the main-process lan-console HTTP(S) server).
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const viteBin = resolve(root, "node_modules", "vite", "bin", "vite.js");

execFileSync(
  process.execPath,
  [viteBin, "build", "--config", resolve(root, "lan-web", "vite.config.ts")],
  { cwd: root, stdio: "inherit" },
);
