import { defineConfig } from "vitest/config";
import path from "path";

// End-to-end HTTP tests. These spawn the built Next server (see the suite's
// beforeAll) and exercise the full cookie/middleware-wired flow across all
// three sides. Requires `next build` to have run first.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globals: true,
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
