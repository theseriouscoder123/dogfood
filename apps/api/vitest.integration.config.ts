import { defineConfig } from "vitest/config";

// Integration tests: the real Express app against a real Postgres database.
// Each run creates a fresh database of its own (see tests/integration/globalSetup.ts).
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    env: { SMTP_URL: "", UPLOAD_DIR: "./.test-uploads", WEBHOOK_ALLOW_PRIVATE_HOSTS: "127.0.0.1", SIGNING_KEY_PATH: "./.test-keys/signing-key.pem" },
    globalSetup: ["tests/integration/globalSetup.ts"],
    setupFiles: ["tests/integration/setupEnv.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
