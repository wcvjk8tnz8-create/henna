import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { Pool } from "pg";
import * as pgSchema from "./schema.pg";
import * as d1Schema from "./schema.d1";
import {
  detectRuntime,
  getD1Binding,
  resolveConnectionString,
  usesD1,
  type D1Binding,
} from "./runtime";

/**
 * Database factory.
 *
 * Three paths, selected at runtime, and only one of them needs any setup:
 *
 *  - **Cloudflare D1** — the default Workers path. The binding is declared by
 *    name in `wrangler.jsonc`, so Cloudflare creates the database on first
 *    deploy. No connection string, no external server, nothing to configure.
 *  - **Hyperdrive + PostgreSQL** — for operators who already run Postgres and
 *    want Workers in front of it. Never calls `pool.end()`; the platform owns
 *    the socket lifecycle.
 *  - **Node.js** — `DATABASE_URL` and a standard `pg` pool.
 *
 * Drizzle is always used with parameterised queries; no module in Henna builds
 * SQL by string concatenation.
 */

export type Database = NodePgDatabase<typeof pgSchema>;

export class DatabaseConfigError extends Error {
  override readonly name = "DatabaseConfigError";
}

let pool: Pool | null = null;
let db: Database | null = null;
let bootstrap: Promise<void> | null = null;

/**
 * Return the shared Drizzle handle.
 *
 * The D1 and Postgres drivers expose the same query-builder surface, so the rest
 * of the app is written once against `Database` and works on either. See the
 * note in `db/schema.ts` about the single cast that makes that possible.
 */
import { applyD1Schema, D1_SCHEMA_SQL, splitSqlStatements } from "./d1-schema";

export { D1_SCHEMA_SQL, splitSqlStatements, applyD1Schema };

export function getDb(): Database {
  if (db !== null) return db;

  if (usesD1()) {
    const binding = getD1Binding();
    if (!binding) {
      throw new DatabaseConfigError(
        "HENNA_DB_KIND=d1 was requested but no D1 binding named DB is present. Add it to wrangler.jsonc.",
      );
    }
    db = drizzleD1(binding as unknown as Parameters<typeof drizzleD1>[0], {
      schema: d1Schema,
    }) as unknown as Database;
    return db;
  }

  const connectionString = resolveConnectionString();
  if (!connectionString.trim()) {
    throw new DatabaseConfigError(
      "No database configured. Provide DATABASE_URL, bind a D1 database named DB, or set a Hyperdrive config.",
    );
  }

  const runtime = detectRuntime();
  pool = new Pool({
    connectionString,
    max: runtime === "workers-pg" ? 5 : 10,
    idleTimeoutMillis: runtime === "workers-pg" ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    // Hyperdrive terminates TLS at the edge; on Node.js we require TLS unless
    // the host is loopback.
    ssl:
      connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
        ? undefined
        : { rejectUnauthorized: true },
  });

  db = drizzlePg(pool, { schema: pgSchema });
  return db;
}

/**
 * Create the schema if it does not exist yet.
 *
 * This is what makes the one-click deployment work: there is no `psql` on
 * Cloudflare, and asking someone to run a CLI command defeats the point of a
 * dashboard deploy. Every statement is `IF NOT EXISTS`, so this is idempotent
 * and safe to call on every cold start; a `_schema_migrations` row records that
 * it has been done.
 *
 * Cached in a promise, so concurrent requests during a cold start share one run.
 */
export async function ensureSchema(): Promise<void> {
  if (bootstrap !== null) return bootstrap;
  bootstrap = runBootstrap().catch((error: unknown) => {
    // Allow a later request to retry rather than caching the failure forever.
    bootstrap = null;
    throw error;
  });
  return bootstrap;
}

async function runBootstrap(): Promise<void> {
  if (!usesD1()) return;
  const binding = getD1Binding();
  if (!binding) return;

  await applyD1Schema(binding);
}

/** Test-only escape hatch: swap in an in-memory or transaction-scoped handle. */
export function setDb(instance: Database | null): void {
  db = instance;
}

/** Graceful shutdown for long-lived Node.js processes. Never called on Workers. */
export async function closeDb(): Promise<void> {
  if (detectRuntime() !== "node") return;
  if (pool) {
    await pool.end();
    pool = null;
    db = null;
  }
}

export { pgSchema, d1Schema };
export { detectRuntime, usesD1 } from "./runtime";
