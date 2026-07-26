import { resolve } from "path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";

/** Pi packages are ESM-only (`exports.import` without `require`); Electron main is CJS. */
const piEsmPackages = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-tui",
];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: piEsmPackages,
      },
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "agent-worker/index": resolve("src/agent-worker/index.ts"),
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
  },
});
