import { resolve } from "path";
import { defineConfig } from "electron-vite";
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
          "session-history-worker": resolve("src/main/session-history-worker.ts"),
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
