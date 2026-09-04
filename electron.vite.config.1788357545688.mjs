// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

// scripts/pi-extension-loader-electron-plugin.ts
function piExtensionLoaderElectronPlugin() {
  const propertyReplacement = "virtualModules: VIRTUAL_MODULES, tryNative: false";
  const rewrite = (code) => {
    if (!code.includes("VIRTUAL_MODULES") || !code.includes("getAliases")) return null;
    if (!code.includes("isBunBinary")) return null;
    let next = code.replace(
      /\.\.\.\s*\(\s*isBunBinary\s*\?\s*\{\s*virtualModules:\s*VIRTUAL_MODULES\s*,\s*tryNative:\s*false\s*\}\s*:\s*\{\s*alias:\s*getAliases\(\)\s*\}\s*\)/g,
      propertyReplacement
    );
    next = next.replace(
      /fileURLToPath\(\s*import\.meta\.resolve\(\s*([^)]+?)\s*\)\s*\)/g,
      "require.resolve($1)"
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
    }
  };
}

// scripts/pi-oauth-electron-plugin.ts
var IMPORT_OAUTH_MODULE_RE = /const importOAuthModule = \(specifier\) => \{[\s\S]*?return import\(__rewriteRelativeImportExtension\(runtimeSpecifier\)\);\r?\n\};/;
var STATIC_IMPORT_OAUTH_MODULE = `const importOAuthModule = (specifier) => {
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
function rewriteImportOAuthModule(code) {
  if (!code.includes("importOAuthModule")) return null;
  if (!code.includes("import(__rewriteRelativeImportExtension")) return null;
  const next = code.replace(IMPORT_OAUTH_MODULE_RE, STATIC_IMPORT_OAUTH_MODULE);
  return next === code ? null : next;
}
function piOAuthElectronPlugin() {
  return {
    name: "pi-oauth-electron",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.includes("@earendil-works/pi-ai")) return null;
      if (!normalized.includes("auth/oauth/load")) return null;
      const next = rewriteImportOAuthModule(code);
      return next ? { code: next, map: null } : null;
    }
  };
}

// electron.vite.config.ts
var piEsmPackages = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui"
];
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [piExtensionLoaderElectronPlugin(), piOAuthElectronPlugin()],
    build: {
      externalizeDeps: {
        exclude: piEsmPackages
      },
      // The main bundle lives inside the asar and is never downloaded, so
      // skip minification there to make every build noticeably faster.
      minify: false,
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "agent-worker/index": resolve("src/agent-worker/index.ts"),
          "asr-cloud-worker": resolve("src/main/asr-cloud-worker.ts"),
          "session-history-worker": resolve("src/main/session-history-worker.ts")
        }
      }
    }
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src")
      }
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === "webview"
          }
        }
      }),
      Components({
        resolvers: [NaiveUiResolver()]
      })
    ],
    build: {
      // Electron 39 ships a modern Chromium: avoid transpiling to old
      // syntax and speed up esbuild.
      target: "chrome130",
      reportCompressedSize: false,
      chunkSizeWarningLimit: 8e3
    }
  }
});
export {
  electron_vite_config_default as default
};
