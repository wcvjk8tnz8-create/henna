import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests run in a Node.js environment.
 *
 * These cover the pure, security-critical modules: crypto, password hashing,
 * TOTP, recovery codes, email OTP rules, Zod boundaries, configuration parsing
 * and the DAL's authorisation decisions. Anything that needs a browser, a
 * database or a real OAuth round-trip lives in tests/e2e.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".open-next/**"],
    coverage: {
      provider: "v8",
      include: ["lib/**"],
      reporter: ["text", "lcov"],
    },
    // Security tests must not be flaky; run files in isolation by default.
    pool: "forks",
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
