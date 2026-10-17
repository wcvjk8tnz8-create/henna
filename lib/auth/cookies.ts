/**
 * Session cookie names.
 *
 * These live alone so that Edge middleware can reference them without importing
 * `lib/auth/session` — which pulls in `node:crypto`, Drizzle and the database.
 * A middleware that imports the data layer cannot run on the Edge runtime at
 * all, and it does not need to: it performs an optimistic redirect and nothing
 * else.
 */

export const ACCESS_COOKIE = "henna_session";
export const REFRESH_COOKIE = "henna_refresh";
/** Holds the pending session id between primary auth and the second factor. */
export const PENDING_MFA_COOKIE = "henna_pending_mfa";
