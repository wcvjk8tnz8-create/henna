import { afterEach, describe, expect, it } from "vitest";
import { detectRuntime, getD1Binding, installCloudflareEnv, usesD1 } from "@/db/runtime";

/**
 * Runtime detection.
 *
 * Worth testing because the wrong answer produces a blank page rather than an
 * error: if a Worker is mistaken for Node, `getDb()` reaches for `pg`, which
 * does not exist in a Workers bundle, and throws before anything renders.
 */

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g.__hennaCloudflareEnv__;
  delete g.__opennextCloudflareContext;
  delete process.env.HENNA_RUNTIME;
  delete process.env.HENNA_DB_KIND;
});

describe("detectRuntime", () => {
  it("uses D1 when a D1 binding is present", () => {
    installCloudflareEnv({ DB: { prepare: () => ({ run: async () => {}, all: async () => ({}) }), batch: async () => [] } });
    expect(detectRuntime()).toBe("workers-d1");
    expect(usesD1()).toBe(true);
    expect(getD1Binding()).not.toBeNull();
  });

  it("uses Postgres on Workers when Hyperdrive is bound", () => {
    installCloudflareEnv({ HYPERDRIVE: { connectionString: "postgresql://x" } });
    expect(detectRuntime()).toBe("workers-pg");
    expect(usesD1()).toBe(false);
  });

  it("falls back to Node when no binding is visible", () => {
    expect(detectRuntime()).toBe("node");
  });

  it("treats workerd as Workers even with no readable binding", () => {
    // The dangerous direction is guessing "node": that routes the app into the
    // pg path. So an unmistakable workerd marker wins over the default.
    const saved = g.WebSocketPair;
    g.WebSocketPair = class {};
    try {
      expect(detectRuntime()).toBe("workers-d1");
    } finally {
      if (saved === undefined) delete g.WebSocketPair;
      else g.WebSocketPair = saved;
    }
  });

  it("recognises the Cloudflare user agent", () => {
    const saved = g.navigator;
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Cloudflare-Workers" },
      configurable: true,
    });
    try {
      expect(detectRuntime()).toBe("workers-d1");
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
    }
  });

  it("honours an explicit override", () => {
    process.env.HENNA_RUNTIME = "workers";
    process.env.HENNA_DB_KIND = "postgres";
    expect(detectRuntime()).toBe("workers-pg");
  });
});
