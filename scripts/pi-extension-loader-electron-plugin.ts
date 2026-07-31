import type { Plugin } from "vite";

/**
 * Pi's extension loader uses `import.meta.resolve` in getAliases() and prefers
 * filesystem aliases when not running as a Bun binary. Electron utilityProcess
 * bundles that loader to CJS, where `import.meta.resolve` becomes `(void 0)` —
 * every extension then fails with "(void 0) is not a function".
 *
 * Force the Bun-style `virtualModules` path so extensions resolve against the
 * already-bundled Pi/typebox copies (correct for Electron packaging too).
 */
export function piExtensionLoaderElectronPlugin(): Plugin {
  /** Keep as object properties (not a nested `{...}`), so createJiti options stay valid. */
  const propertyReplacement = "virtualModules: VIRTUAL_MODULES, tryNative: false";

  const rewrite = (code: string): string | null => {
    if (!code.includes("VIRTUAL_MODULES") || !code.includes("getAliases")) return null;
    if (!code.includes("isBunBinary")) return null;

    let next = code.replace(
      /\.\.\.\s*\(\s*isBunBinary\s*\?\s*\{\s*virtualModules:\s*VIRTUAL_MODULES\s*,\s*tryNative:\s*false\s*\}\s*:\s*\{\s*alias:\s*getAliases\(\)\s*\}\s*\)/g,
      propertyReplacement,
    );
    // Safety: import.meta.resolve → require.resolve (returns a filesystem path).
    next = next.replace(
      /fileURLToPath\(\s*import\.meta\.resolve\(\s*([^)]+?)\s*\)\s*\)/g,
      "require.resolve($1)",
    );
    return next === code ? null : next;
  };

  return {
    name: "pi-extension-loader-electron",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.includes("@earendil-works/pi-coding-agent")) return null;
      if (!normalized.includes("extensions/loader")) return null;
      const next = rewrite(code);
      return next ? { code: next, map: null } : null;
    },
    renderChunk(code) {
      if (!code.includes("VIRTUAL_MODULES") || !code.includes("getAliases")) return null;
      const next = rewrite(code);
      return next ? { code: next, map: null } : null;
    },
  };
}
