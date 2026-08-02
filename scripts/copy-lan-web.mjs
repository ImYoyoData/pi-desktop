/**
 * Copy the LAN web console page into the build output so the main process
 * can serve it (out/lan-web/index.html, reachable from out/main at runtime
 * in dev and inside the asar when packaged).
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const src = join(root, "src", "lan-web", "index.html");
const outDir = join(root, "out", "lan-web");
const dest = join(outDir, "index.html");

mkdirSync(outDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied lan-web -> ${dest}`);
