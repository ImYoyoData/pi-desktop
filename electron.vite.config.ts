import { resolve } from "path";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import { piExtensionLoaderElectronPlugin } from "./scripts/pi-extension-loader-electron-plugin";
import { piOAuthElectronPlugin } from "./scripts/pi-oauth-electron-plugin";

/** Pi packages are ESM-only (`exports.import` without `require`); Electron main is CJS. */
const piEsmPackages = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

/** monaco 只保留 utils/editor-lang.ts 会映射到的 21 种语言定义，其余 60 种不再进产物 */
const monacoLanguages = new Set([
  "c",
  "cpp",
  "csharp",
  "css",
  "go",
  "html",
  "ini",
  "java",
  "javascript",
  "kotlin",
  "less",
  "markdown",
  "powershell",
  "python",
  "rust",
  "scss",
  "shell",
  "sql",
  "typescript",
  "xml",
  "yaml",
]);

function trimMonacoLanguages(): Plugin {
  return {
    name: "pi-trim-monaco-languages",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]monaco-editor[\\/]esm[\\/]vs[\\/](index|editor\.main)\.js$/.test(id)) {
        return null;
      }
      const trimmed = code.replace(
        /^import '\.{1,2}\/languages\/definitions\/([\w.-]+)\/register\.js';\r?\n/gm,
        (line, lang: string) => (monacoLanguages.has(lang) ? line : ""),
      );
      return trimmed === code ? null : trimmed;
    },
  };
}

export default defineConfig({
  main: {
    plugins: [piExtensionLoaderElectronPlugin(), piOAuthElectronPlugin()],
    build: {
      externalizeDeps: {
        exclude: piEsmPackages,
      },
      // The main bundle lives inside the asar and is never downloaded, so
      // skip minification there to make every build noticeably faster.
      minify: false,
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "agent-worker/index": resolve("src/agent-worker/index.ts"),
          "asr-cloud-worker": resolve("src/main/asr-cloud-worker.ts"),
          "asr-gpu-detect-worker": resolve("src/main/asr-gpu-detect-worker.ts"),
          "session-history-worker": resolve(
            "src/main/session-history-worker.ts",
          ),
        },
      },
    },
  },
  preload: {},
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === "webview",
          },
        },
      }),
      Components({
        resolvers: [NaiveUiResolver()],
      }),
      trimMonacoLanguages(),
    ],
    build: {
      // Electron 39 ships a modern Chromium: avoid transpiling to old
      // syntax and speed up esbuild.
      target: "chrome130",
      reportCompressedSize: false,
      chunkSizeWarningLimit: 8000,
    },
  },
});
