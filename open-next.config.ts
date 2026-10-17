import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext configuration for Cloudflare Workers.
 *
 * `nodejs_compat` is enabled in wrangler.jsonc, which is what makes
 * `node:crypto`'s scrypt and the `crypto` module available to Henna's password
 * hashing and AES-256-GCM code on Workers.
 *
 * The default configuration is deliberately left in place: every cache
 * implementation defaults to a no-op "dummy", which is exactly what Henna
 * wants. Every response is user-specific and authenticated, so a shared cache
 * in front of it would be a correctness bug, not an optimisation — cached mail
 * pages for one user must never be served to another.
 *
 * Nothing needs wiring up here for D1 or R2 either: those are bound by name in
 * wrangler.jsonc and read through `getD1Binding()`.
 */
export default defineCloudflareConfig();
