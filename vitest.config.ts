import { defineConfig } from "vitest/config";
import path from "path";

// Unit + integration + API-handler tests. Fast, no server. Each test runs
// against an isolated JSON data dir (see tests/setup.ts).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/api/**/*.test.ts",
    ],
    environment: "node",
    globals: true,
    // The JSON store writes to a shared data dir; keep files sequential so
    // parallel suites don't race on it.
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20000,
    env: {
      DATA_DIR: path.resolve(__dirname, ".test-data"),
      GEOCODER: "none",
      STORE_DRIVER: "json",
    },
  },
});
