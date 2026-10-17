import { afterEach, describe, expect, it } from "vitest";
import { getRootConfig, resetEnvCache, resetEnvSource, setEnvSource } from "@/lib/config/env";
import { getCloudflareVars, installCloudflareEnv } from "@/db/runtime";

/**
 * Root configuration must be reachable from the Cloudflare binding, not only
 * from `process.env`.
 *
 * This is the regression test for a real deployment bug: `/api/health` (a Route
 * Handler) reported all three root variables present while the sign-in page (a
 * Server Component) in the same deployment saw all three as undefined. OpenNext
 * does not populate `process.env` from dashboard secrets uniformly, so reading
 * the binding first is the only lookup path that behaves the same everywhere.
 */

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__hennaCloudflareEnv__;
  delete g.__opennextCloudflareContext;
  resetEnvSource();
});

describe("root config sources", () => {
  it("reads root variables from the Cloudflare binding when process.env lacks them", () => {
    // Simulates the Server Component: process.env is empty, but the Worker's
    // env carries the dashboard secrets.
    installCloudflareEnv({
      DOMAIN: '["example.com"]',
      ADMIN: "admin@example.com",
      jwt_secret: "abc123",
    } as never);

    const config = getRootConfig();
    expect(config.DOMAIN).toEqual(["example.com"]);
    expect(config.ADMIN).toBe("admin@example.com");
    expect(config.jwt_secret).toBe("abc123");
  });

  it("exposes binding string values through getCloudflareVars", () => {
    installCloudflareEnv({
      DOMAIN: '["example.com"]',
      ADMIN: "admin@example.com",
      jwt_secret: "abc123",
      DB: { prepare: () => ({}) },
    } as never);
    const vars = getCloudflareVars();
    expect(vars.DOMAIN).toBe('["example.com"]');
    // Non-string values are bindings, not configuration; they must not leak in.
    expect(vars.DB).toBeUndefined();
  });

  it("still works with no Cloudflare binding at all", () => {
    const saved = { ...process.env };
    process.env.DOMAIN = '["example.com"]';
    process.env.ADMIN = "admin@example.com";
    process.env.jwt_secret = "abc123";
    resetEnvCache();
    try {
      expect(getRootConfig().ADMIN).toBe("admin@example.com");
    } finally {
      for (const key of ["DOMAIN", "ADMIN", "jwt_secret"]) delete process.env[key];
      void saved;
    }
  });

  it("prefers the binding over process.env when both are present", () => {
    const saved = { ...process.env };
    process.env.DOMAIN = '["from-process-env"]';
    process.env.ADMIN = "old@example.com";
    process.env.jwt_secret = "old";
    installCloudflareEnv({ ADMIN: "new@example.com" } as never);
    resetEnvCache();
    try {
      // The dashboard is the source of truth; a stale copy must not win.
      expect(getRootConfig().ADMIN).toBe("new@example.com");
    } finally {
      for (const key of ["DOMAIN", "ADMIN", "jwt_secret"]) delete process.env[key];
      void saved;
    }
  });
});
