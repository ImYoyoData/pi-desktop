import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

// cwd is the repo root (build-lan-web.mjs runs from there).
const root = process.cwd();

export default defineConfig({
  root: resolve(root, "lan-web"),
  plugins: [vue()],
  base: "./",
  resolve: {
    alias: [
      // More-specific aliases MUST come before the `@renderer` prefix alias.
      {
        find: "@renderer/utils/mermaid-render",
        replacement: resolve(root, "lan-web/src/stubs/mermaid-render.ts"),
      },
      {
        find: "@renderer/utils/dot-render",
        replacement: resolve(root, "lan-web/src/stubs/dot-render.ts"),
      },
      { find: "@renderer", replacement: resolve(root, "src/renderer/src") },
      { find: "@shared", replacement: resolve(root, "src/shared") },
    ],
  },
  optimizeDeps: {
    include: ["naive-ui", "@vicons/ionicons5", "pinia", "marked", "dompurify", "highlight.js", "katex"],
    exclude: ["mermaid", "@viz-js/viz"],
  },
  build: {
    outDir: resolve(root, "out/lan-web"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: true,
    reportCompressedSize: false,
    minify: "esbuild",
    modulePreload: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/naive-ui") || id.includes("node_modules/@css-render")) {
            return "naive";
          }
          if (
            id.includes("node_modules/highlight.js") ||
            id.includes("node_modules/katex") ||
            id.includes("node_modules/marked")
          ) {
            return "markdown";
          }
          if (
            id.includes("src/renderer/src/components/MessageList") ||
            id.includes("src/renderer/src/components/ToolCall") ||
            id.includes("src/renderer/src/components/Thinking") ||
            id.includes("src/renderer/src/components/Markdown")
          ) {
            return "chat-ui";
          }
        },
      },
    },
    chunkSizeWarningLimit: 4000,
  },
});
