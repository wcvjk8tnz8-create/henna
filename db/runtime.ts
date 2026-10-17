/**
 * Runtime detection and Cloudflare binding access.
 *
 * This module deliberately imports nothing from the schema, so both schema
 * modules can depend on it without a cycle. It answers one question — are we on
 * Workers with a D1 binding, or on Node.js with a Postgres URL — and that answer
 * decides which Drizzle dialect the rest of the app is built on.
 *
 * Getting this wrong is how a deploy ends up a blank page: Workers bindings are
 * objects, not strings, so they are invisible on `process.env`. If nothing here
 * recognises Workers, the app concludes it is on Node, reaches for `pg`, and —
 * on Workers, where pg is deliberately absent — throws before anything renders.
 */

export type RuntimeKind = "workers-d1" | "workers-pg" | "node";

/** Minimal shape of the D1 binding Henna declares in wrangler.jsonc. */
export interface D1Binding {
  prepare(sql: string): { run(): Promise<unknown>; all(): Promise<{ results?: unknown[] }> };
  batch(statements: unknown[]): Promise<unknown[]>;
}

export interface CloudflareEnvShape {
  DB?: D1Binding;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
}

/**
 * True when running under workerd, checked independently of any binding.
 *
 * Used as a last resort so that a Workers deploy with an unreachable context is
 * still treated as Workers. Guessing "node" instead is the dangerous direction:
 * it routes the app into the pg code path, which does not exist on Workers.
 */
function looksLikeWorkerd(): boolean {
  const g = globalThis as Record<string, unknown>;
  if (g.WebSocketPair !== undefined) return true;
  const navigator = g.navigator as { userAgent?: string } | undefined;
  if (navigator?.userAgent === "Cloudflare-Workers") return true;
  return false;
}

/**
 * Read the Cloudflare environment.
 *
 * Order matters. An explicitly injected global wins so tests can drive this
 * without workerd; then OpenNext's request context, which is the real source on
 * a deployed Worker; then a couple of shapes seen across OpenNext versions.
 */
function getCloudflareEnv(): CloudflareEnvShape | null {
  const injected = (globalThis as { __hennaCloudflareEnv__?: CloudflareEnvShape })
    .__hennaCloudflareEnv__;
  if (injected) return injected;

  // The documented path: OpenNext exposes bindings through a request-scoped
  // context. Called here rather than through instrumentation.ts because if that
  // file is not loaded, nothing else can see the binding either — and a Worker
  // that cannot see its binding takes the Node path and renders nothing.
  //
  // It throws outside a request (build-time static generation), which is not an
  // error: it just means "no bindings available right now".
  for (const read of [readContextDirect, readInstalledContext]) {
    try {
      const env = read();
      if (env) return env;
    } catch {
      // try the next source
    }
  }

  const legacy = (process.env as Record<string, unknown>).HYPERDRIVE;
  if (typeof legacy === "object" && legacy !== null) {
    return legacy as CloudflareEnvShape;
  }
  return null;
}

/** `getCloudflareContext()` from the package, if it is resolvable at all. */
function readContextDirect(): CloudflareEnvShape | null {
  const fn = (globalThis as {
    __hennaGetCloudflareContext?: () => { env?: CloudflareEnvShape };
  }).__hennaGetCloudflareContext;
  if (typeof fn !== "function") return null;
  return fn()?.env ?? null;
}

/** Installed by instrumentation.ts, which has the real static import. */
function readInstalledContext(): CloudflareEnvShape | null {
  const fn = (globalThis as {
    __opennextCloudflareContext?: () => { env?: CloudflareEnvShape };
  }).__opennextCloudflareContext;
  if (typeof fn !== "function") return null;
  return fn()?.env ?? null;
}

export function getD1Binding(): D1Binding | null {
  return getCloudflareEnv()?.DB ?? null;
}

/**
 * Every variable and binding visible on the Worker's `env`.
 *
 * Used as the primary source of root configuration. Dashboard secrets live
 * here as plain string properties, which is why this is more reliable on
 * Workers than `process.env` — see lib/config/env.ts.
 */
export function getCloudflareVars(): Record<string, string | undefined> {
  const env = getCloudflareEnv();
  if (!env) return {};
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env as Record<string, unknown>)) {
    if (typeof value === "string") out[name] = value;
  }
  return out;
}

export function detectRuntime(): RuntimeKind {
  const cf = getCloudflareEnv();
  if (cf?.DB) return "workers-d1";
  if (cf?.HYPERDRIVE || cf?.DATABASE_URL) return "workers-pg";
  if (process.env.HENNA_RUNTIME === "workers") {
    return process.env.HENNA_DB_KIND === "postgres" ? "workers-pg" : "workers-d1";
  }
  // No binding was read, but the platform is unmistakably Workers: assume D1.
  // The alternative — claiming Node — sends every request into the pg path.
  if (looksLikeWorkerd()) return "workers-d1";
  return "node";
}

/** True when the SQLite/D1 dialect should be used. */
export function usesD1(): boolean {
  return detectRuntime() === "workers-d1" || process.env.HENNA_DB_KIND === "d1";
}

export function resolveConnectionString(): string {
  const cf = getCloudflareEnv();
  if (cf?.HYPERDRIVE?.connectionString) return cf.HYPERDRIVE.connectionString;
  if (cf?.DATABASE_URL) return cf.DATABASE_URL;
  return process.env.DATABASE_URL ?? "";
}

/**
 * Called once per request by the Worker entry point.
 *
 * Putting the bindings on a global is what makes them reachable from the
 * synchronous `getDb()` path without threading a context argument through every
 * DAL function.
 */
export function installCloudflareEnv(env: CloudflareEnvShape): void {
  (globalThis as { __hennaCloudflareEnv__?: CloudflareEnvShape }).__hennaCloudflareEnv__ = env;
}
