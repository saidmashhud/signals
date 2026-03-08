import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      signals: resolve(__dirname, "../src/core/index.ts"),
    },
  },
});
