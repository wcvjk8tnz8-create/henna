/**
 * Stand-in for the `pg` package in the Cloudflare Workers bundle.
 *
 * Henna talks to D1 on Workers and to PostgreSQL only when self-hosted on Node.
 * `pg` is still imported at module scope by `db/index.ts`, so without a
 * substitute the bundler drags it into the Worker — and then fails, because pg
 * selects its `workerd` entrypoint under the workerd export condition, which
 * requires `pg-cloudflare`, whose published tarball is missing the `dist/` it
 * declares. The bundle dies with `Could not resolve "pg-cloudflare"` even though
 * no Worker request would ever have used it.
 *
 * This module is aliased over `pg` for Workers builds only (see the
 * HENNA_BUILD_TARGET branch in next.config.ts). Constructing it throws, which is
 * the honest behaviour: on Workers it can never be reached, because
 * `usesD1()` is true and the D1 branch runs instead.
 */

export class Pool {
  constructor(..._args: never[]) {
    throw new Error(
      "pg is not available in a Cloudflare Workers build. Henna uses D1 on " +
        "Workers; PostgreSQL is only supported when self-hosted on Node.",
    );
  }
}

export default { Pool };
