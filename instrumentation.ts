/**
 * Runs once when the server starts, before any request is handled.
 *
 * Its only job is to make Cloudflare bindings reachable from the synchronous
 * database path. Bindings are objects on the Worker's `env`, not strings on
 * `process.env`, so `getDb()` cannot see them on its own — and if it cannot see
 * them it concludes the app is on Node, reaches for `pg`, and on Workers throws
 * before a single byte is rendered. That is a blank page with no error anywhere.
 *
 * A function is installed rather than a value because the context is
 * request-scoped: calling it inside a request returns the real bindings, and
 * calling it outside one (during build-time static generation) simply throws,
 * which db/runtime.ts treats as "no bindings right now".
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") {
    return;
  }

  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    (globalThis as {
      __opennextCloudflareContext?: () => { env?: unknown };
    }).__opennextCloudflareContext = () => getCloudflareContext() as { env?: unknown };
  } catch {
    // Not running on Cloudflare (local `next dev`, or a Node deployment).
    // Nothing to install; db/runtime.ts falls through to the Node path.
  }
}
