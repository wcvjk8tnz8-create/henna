import { redirect } from "next/navigation";
import { resolveSessionFromCookies } from "@/lib/dal/session";


/**
 * Never prerendered.
 *
 * This page reads the database, and at build time there is none: no D1 binding,
 * no DATABASE_URL, no Hyperdrive. Next prerendering it anyway killed the build
 * with "No database configured" — a build-time failure for a runtime-only
 * reason. Pages that read the database all need this.
 */
export const dynamic = "force-dynamic";

/** Send visitors to the right place; the DAL makes the real decision. */
export default async function HomePage() {
  const resolved = await resolveSessionFromCookies();
  if (!resolved) redirect("/login");
  redirect(resolved.principal.mfaSatisfied ? "/inbox" : "/mfa");
}
