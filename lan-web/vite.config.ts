import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// cwd is the repo root (build-lan-web.mjs runs from there).
const root = process.cwd();

export default defineConfig({
  root: resolve(root, "lan-web"),
  plugins: [vue()],
  base: "./",
  build: {
    outDir: resolve(root, "out/lan-web"),
    emptyOutDir: true,
    target: "chrome110",
  },
});
