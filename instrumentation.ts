/**
 * Runs once when the server starts, before any request is handled.
 *
 * Its only job is to make Cloudflare bindings reachable from the synchronous
 * database path. Bindings are objects on the Worker's `env`, not strings on
 * `process.env`, so `getDb()` cannot see them on its own — and if it cannot see
 * them it concludes the app is on Node, reaches for `pg`, and on Workers throws
 * before a single byte is rendered. That is a blank page with no error anywhere.
 *
 * The accessor is a *function*, not a value, because the context is
 * request-scoped: calling it inside a request returns the real bindings, and
 * calling it outside one (during build-time static generation) throws, which
 * db/runtime.ts reads as "no bindings right now".
 *
 * Two globals are set so that whichever import path works is used, and a
 * failure to install is silent — db/runtime.ts has its own fallbacks and must
 * keep working if this file is not loaded at all.
 */
export async function register(): Promise<void> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const read = () => getCloudflareContext() as { env?: unknown };
    const g = globalThis as Record<string, unknown>;
    g.__opennextCloudflareContext = read;
    g.__hennaGetCloudflareContext = read;
  } catch {
    // Not on Cloudflare (local `next dev`, or a Node deployment). Nothing to
    // install; db/runtime.ts falls through to the Node path.
  }
}
