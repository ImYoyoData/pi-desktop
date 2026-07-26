import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      pinia: path.resolve(__dirname, "tests/mocks/pinia-stub.ts"),
      vue: path.resolve(__dirname, "tests/mocks/vue-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
