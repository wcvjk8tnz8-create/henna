import { redirect } from "next/navigation";
import { requirePrincipal } from "@/lib/dal/guards";
import { AuthzError, redirectTargetFor } from "@/lib/dal/guards";
import { getOwnProfile } from "@/lib/dal/users";
import { getUserSettings } from "@/lib/dal/settings";
import { listCredentials } from "@/lib/dal/credentials";
import { MailShell } from "@/components/mail/mail-shell";


/**
 * Never prerendered.
 *
 * This page reads the database, and at build time there is none: no D1 binding,
 * no DATABASE_URL, no Hyperdrive. Next prerendering it anyway killed the build
 * with "No database configured" — a build-time failure for a runtime-only
 * reason. Pages that read the database all need this.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Inbox" };

/**
 * The mail surface.
 *
 * Nothing on this page asks Henna's server for message bodies, attachments or
 * search results. The browser holds the upstream credential (JMAP) or requests a
 * short-lived in-memory connection (IMAP fallback on Node.js), and mail content
 * travels browser ↔ upstream only.
 */
export default async function InboxPage() {
  let principal;
  try {
    principal = await requirePrincipal();
  } catch (error) {
    if (error instanceof AuthzError) redirect(redirectTargetFor(error));
    throw error;
  }

  const [profile, settings, credentials] = await Promise.all([
    getOwnProfile(principal),
    getUserSettings(principal),
    listCredentials(principal),
  ]);

  if (!profile) redirect("/login");

  return (
    <MailShell
      email={profile.email}
      role={profile.role}
      settings={settings}
      hasCredential={credentials.length > 0}
      credential={credentials[0] ?? null}
    />
  );
}
