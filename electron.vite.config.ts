import { resolve } from "path";
import { defineConfig } from "electron-vite";
import vue from "@vitejs/plugin-vue";

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
      // Bundle ESM-only Pi SDK into main/worker so CJS require() is not used at runtime.
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
    plugins: [vue()],
  },
});
