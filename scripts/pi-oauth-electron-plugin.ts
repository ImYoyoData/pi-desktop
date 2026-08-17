import type { Plugin } from "vite";

/**
 * Pi AI loads OAuth flows via a variable dynamic import so browser bundlers
 * cannot follow Node-only modules (`node:http` callback, PKCE, …):
 *
 *   import(__rewriteRelativeImportExtension(runtimeSpecifier))
 *
 * Electron packages `@earendil-works/pi-ai` into `out/main/chunks/*.js`. Those
 * relative imports then resolve next to the hashed chunk and fail:
 * "Cannot find module .../openai-codex.js" (GitHub #10).
 *
 * Rewrite to static `import("./….js")` strings so Rollup emits real chunks
 * (or inlines them) and rewrites paths to the hashed output names.
 */
const IMPORT_OAUTH_MODULE_RE =
  /const importOAuthModule = \(specifier\) => \{[\s\S]*?return import\(__rewriteRelativeImportExtension\(runtimeSpecifier\)\);\r?\n\};/;

const STATIC_IMPORT_OAUTH_MODULE = `const importOAuthModule = (specifier) => {
  const key = String(specifier).replace(/\\.js$/, ".ts");
  switch (key) {
    case "./anthropic.ts":
      return import("./anthropic.js");
    case "./openai-codex.ts":
      return import("./openai-codex.js");
    case "./github-copilot.ts":
      return import("./github-copilot.js");
    case "./openrouter.ts":
      return import("./openrouter.js");
    case "./kimi-coding.ts":
      return import("./kimi-coding.js");
    case "./xai.ts":
      return import("./xai.js");
    case "./radius.ts":
      return import("./radius.js");
    default:
      throw new Error("Unknown OAuth module: " + specifier);
  }
};`;

function rewriteImportOAuthModule(code: string): string | null {
  if (!code.includes("importOAuthModule")) return null;
  if (!code.includes("import(__rewriteRelativeImportExtension")) return null;
  const next = code.replace(IMPORT_OAUTH_MODULE_RE, STATIC_IMPORT_OAUTH_MODULE);
  return next === code ? null : next;
}

export function piOAuthElectronPlugin(): Plugin {
  return {
    name: "pi-oauth-electron",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.includes("@earendil-works/pi-ai")) return null;
      if (!normalized.includes("auth/oauth/load")) return null;
      const next = rewriteImportOAuthModule(code);
      return next ? { code: next, map: null } : null;
    },
  };
}

/** Exposed for unit tests. */
export const __test = {
  rewriteImportOAuthModule,
  STATIC_IMPORT_OAUTH_MODULE,
};
