/**
 * Session cookie names.
 *
 * These live alone so that a module can name a session cookie without importing
 * `lib/auth/session` — which pulls in `node:crypto`, Drizzle and the database.
 * Nothing outside the data layer needs the full session module just to say
 * which cookie to read.
 */

export const ACCESS_COOKIE = "henna_session";
export const REFRESH_COOKIE = "henna_refresh";
/** Holds the pending session id between primary auth and the second factor. */
export const PENDING_MFA_COOKIE = "henna_pending_mfa";
