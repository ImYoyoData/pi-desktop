/**
 * pi-coding-agent imports `highlight.js/lib/index.js` (highlight.js@10 style).
 * highlight.js@11's package "exports" omits that subpath, which crashes Electron main:
 *   ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/index.js' is not defined
 *
 * Patch every highlight.js@11+ copy under node_modules (npm / pnpm / nested).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = path.join(root, "node_modules");

const entry = {
  types: "./types/index.d.ts",
  require: "./lib/index.js",
  import: "./es/index.js",
};

/** @param {string} dir */
function* walkPackageJsons(dir) {
  if (!fs.existsSync(dir)) return;
  /** @type {string[]} */
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        // Skip heavy / irrelevant trees
        if (ent.name === ".cache" || ent.name === "dist" || ent.name === "src") continue;
        stack.push(full);
      } else if (ent.name === "package.json" && path.basename(current) === "highlight.js") {
        yield full;
      }
    }
  }
}

let patched = 0;
let skipped = 0;

for (const pkgPath of walkPackageJsons(nodeModules)) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch {
    skipped += 1;
    continue;
  }
  if (pkg.name !== "highlight.js" || !pkg.exports || typeof pkg.exports !== "object") {
    skipped += 1;
    continue;
  }

  // v10 already exposes lib paths; only v11+ needs the shim
  const major = Number.parseInt(String(pkg.version ?? "0").split(".")[0] ?? "0", 10);
  if (Number.isFinite(major) && major < 11) {
    skipped += 1;
    continue;
  }

  const before = JSON.stringify(pkg.exports["./lib/index.js"]);
  pkg.exports["./lib/index.js"] = entry;
  pkg.exports["./lib/index"] = entry;
  if (before === JSON.stringify(entry)) {
    skipped += 1;
    continue;
  }

  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  patched += 1;
  console.log(`[patch-highlightjs] patched ${path.relative(root, pkgPath)}`);
}

if (patched === 0 && skipped === 0) {
  console.warn("[patch-highlightjs] highlight.js not found; skip");
}
