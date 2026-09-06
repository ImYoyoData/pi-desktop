/**
 * pi-coding-agent imports highlight.js@10 style subpaths
 * (`highlight.js/lib/index.js`, `highlight.js/lib/core.js`,
 * `highlight.js/lib/languages/*.js`). highlight.js@11's package "exports"
 * omits the `.js`-suffixed forms, which crashes Electron main:
 *   ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './lib/core.js' is not defined
 *
 * Patch every highlight.js@11+ copy under node_modules (npm / pnpm / nested):
 * expose every file under lib/ (require → lib, import → es mirror).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeModules = path.join(root, "node_modules");

const indexEntry = {
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

/** All .js files under the package's lib/ dir, as posix subpaths ("lib/core.js"). */
function libJsSubpaths(pkgDir) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && ent.name.endsWith(".js")) {
        out.push(path.relative(pkgDir, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(pkgDir, "lib"));
  return out;
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

  const pkgDir = path.dirname(pkgPath);
  const before = JSON.stringify(pkg.exports);
  pkg.exports["./lib/index.js"] = indexEntry;
  pkg.exports["./lib/index"] = indexEntry;
  for (const rel of libJsSubpaths(pkgDir)) {
    const key = `./${rel}`;
    if (pkg.exports[key]) continue;
    const esRel = `es/${rel.slice("lib/".length)}`;
    const hasEsMirror = fs.existsSync(path.join(pkgDir, esRel));
    pkg.exports[key] = {
      require: `./${rel}`,
      import: hasEsMirror ? `./${esRel}` : `./${rel}`,
    };
  }
  if (JSON.stringify(pkg.exports) === before) {
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
