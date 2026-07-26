/**
 * pi-coding-agent imports `highlight.js/lib/index.js` (highlight.js@10 style).
 * highlight.js@11's package "exports" omits that subpath, which crashes Electron main:
 *   ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/index.js' is not defined
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "node_modules", "highlight.js", "package.json");

if (!fs.existsSync(pkgPath)) {
  console.warn("[patch-highlightjs] highlight.js not installed; skip");
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (!pkg.exports || typeof pkg.exports !== "object") {
  process.exit(0);
}

const entry = {
  types: "./types/index.d.ts",
  require: "./lib/index.js",
  import: "./es/index.js",
};

const before = JSON.stringify(pkg.exports["./lib/index.js"]);
pkg.exports["./lib/index.js"] = entry;
pkg.exports["./lib/index"] = entry;

if (before === JSON.stringify(entry)) {
  process.exit(0);
}

fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log("[patch-highlightjs] added exports for ./lib/index.js");
