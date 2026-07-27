import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@renderer": path.resolve(__dirname, "src/renderer/src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
