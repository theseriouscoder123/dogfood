import { defineConfig } from "vitest/config";

// Unit tests: pure functions, no database. Fast; run on every change.
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"] },
});
