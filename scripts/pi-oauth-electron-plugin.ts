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
 *
 * Additionally, the OAuth modules call bare `fetch` for their token endpoints.
 * Node's `NODE_USE_ENV_PROXY` only takes effect at process bootstrap — setting
 * it from the main module is too late, so OAuth requests would always go
 * direct and fail behind a proxy. Rewrite those calls to Electron's
 * `net.fetch` (Chromium stack), which follows the session proxy rules — the
 * same route the user's browser takes. The main process assigns
 * `globalThis.__piDesktopOAuthFetch` early at startup.
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
    case "./openai-chatgpt.ts":
      return import("./openai-chatgpt.js");
    case "./meta.ts":
      return import("./meta.js");
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

/** OAuth modules call their token endpoints only as `await fetch(...)`; rewrite those to the
 * desktop bridge (Electron net.fetch via a startup-assigned global, same proxy route as the
 * user's browser). A looser pattern would also hit method definitions in shared chunks. */
const OAUTH_FETCH_RE = /(?<![\w$.])await fetch\(/g;
const OAUTH_FETCH_REPLACEMENT =
  "await (globalThis.__piDesktopOAuthFetch ?? globalThis.fetch)(";

function rewriteImportOAuthModule(code: string): string | null {
  if (!code.includes("importOAuthModule")) return null;
  if (!code.includes("import(__rewriteRelativeImportExtension")) return null;
  const next = code.replace(IMPORT_OAUTH_MODULE_RE, STATIC_IMPORT_OAUTH_MODULE);
  return next === code ? null : next;
}

function rewriteOAuthFetches(code: string): string | null {
  if (!OAUTH_FETCH_RE.test(code)) return null;
  OAUTH_FETCH_RE.lastIndex = 0;
  return code.replace(OAUTH_FETCH_RE, OAUTH_FETCH_REPLACEMENT);
}

function rewriteCode(code: string): string | null {
  const afterFetch = rewriteOAuthFetches(code);
  const afterImport = rewriteImportOAuthModule(afterFetch ?? code);
  const next = afterImport ?? afterFetch;
  return next && next !== code ? next : null;
}

export function piOAuthElectronPlugin(): Plugin {
  return {
    name: "pi-oauth-electron",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.includes("@earendil-works/pi-ai")) return null;
      if (!normalized.includes("auth/oauth/")) return null;
      const next = rewriteCode(code);
      return next ? { code: next, map: null } : null;
    },
  };
}

/** Exposed for unit tests. */
export const __test = {
  rewriteImportOAuthModule,
  rewriteOAuthFetches,
  STATIC_IMPORT_OAUTH_MODULE,
};
