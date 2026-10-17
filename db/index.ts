import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Database factory.
 *
 * Two connection paths, selected at runtime:
 *
 *  - Cloudflare Workers: a Hyperdrive binding exposes a pooled connection
 *    string. Workers must never call `pool.end()` — the platform owns the
 *    socket lifecycle — and connections are reused across requests.
 *  - Node.js (self-hosted, CI, tests): `DATABASE_URL` with a standard `pg`
 *    pool.
 *
 * Drizzle is always used with parameterised queries; no module in Henna builds
 * SQL by string concatenation.
 */

export type Database = NodePgDatabase<typeof schema>;

interface HyperdriveBinding {
  connectionString: string;
}

interface CloudflareEnvShape {
  HYPERDRIVE?: HyperdriveBinding;
  DATABASE_URL?: string;
}

/**
 * Access the Cloudflare environment when running on Workers.
 *
 * OpenNext exposes bindings on `process.env` for plain variables, but
 * Hyperdrive is a binding object, so we also look at the global that OpenNext
 * installs. Both paths are optional: on Node.js this returns null and the
 * `DATABASE_URL` path is used.
 */
function getCloudflareEnv(): CloudflareEnvShape | null {
  const candidate = (globalThis as { __hennaCloudflareEnv__?: CloudflareEnvShape })
    .__hennaCloudflareEnv__;
  if (candidate && (candidate.HYPERDRIVE || candidate.DATABASE_URL)) {
    return candidate;
  }
  const hyperdrive = (process.env as Record<string, unknown>).HYPERDRIVE;
  if (typeof hyperdrive === "object" && hyperdrive !== null) {
    return hyperdrive as CloudflareEnvShape;
  }
  return null;
}

export type RuntimeKind = "workers" | "node";

export function detectRuntime(): RuntimeKind {
  const cf = getCloudflareEnv();
  if (cf?.HYPERDRIVE || cf?.DATABASE_URL) return "workers";
  if (process.env.HENNA_RUNTIME === "workers") return "workers";
  return "node";
}

export class DatabaseConfigError extends Error {
  override readonly name = "DatabaseConfigError";
}

function resolveConnectionString(): string {
  const cf = getCloudflareEnv();
  if (cf?.HYPERDRIVE?.connectionString) {
    return cf.HYPERDRIVE.connectionString;
  }
  if (cf?.DATABASE_URL) {
    return cf.DATABASE_URL;
  }
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === "") {
    throw new DatabaseConfigError(
      "No database configured. Provide DATABASE_URL, or bind a Hyperdrive config named HYPERDRIVE on Cloudflare Workers.",
    );
  }
  return url;
}

let pool: Pool | null = null;
let db: Database | null = null;

/**
 * Return the shared Drizzle handle.
 *
 * On Workers the pool intentionally keeps `max` low and never ends: each
 * isolate gets its own pool and the platform reclaims it.
 */
export function getDb(): Database {
  if (db !== null) return db;

  const connectionString = resolveConnectionString();
  const runtime = detectRuntime();

  pool = new Pool({
    connectionString,
    max: runtime === "workers" ? 5 : 10,
    idleTimeoutMillis: runtime === "workers" ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    // Hyperdrive terminates TLS at the edge; on Node.js we require TLS when the
    // host is not loopback.
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? undefined
      : { rejectUnauthorized: true },
  });

  db = drizzle(pool, { schema });
  return db;
}

/** Test-only escape hatch: swap in an in-memory or transaction-scoped handle. */
export function setDb(instance: Database | null): void {
  db = instance;
}

/** Graceful shutdown for long-lived Node.js processes. Never called on Workers. */
export async function closeDb(): Promise<void> {
  if (detectRuntime() === "workers") return;
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export { schema };
