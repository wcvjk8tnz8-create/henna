import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getInstanceSettings } from "@/lib/config/settings";
import { getAdminEmail } from "@/lib/config/env";
import { isManagedAddress } from "@/lib/config/domains";

/**
 * Registration policy.
 *
 * All of it lives here, in the DAL, because whether an address may register is
 * an authorisation decision — the page only renders what this returns.
 *
 * Two ways in:
 *
 *  - **Bootstrap.** No user exists at all, and the address is exactly the one
 *    in the `ADMIN` setting. This is the only path into a fresh instance: the
 *    `ADMIN` variable names an identity but never carries a credential, so
 *    without this the instance is unreachable by anyone. It is safe because
 *    there is no existing account to displace, and the address must match
 *    exactly.
 *  - **Open.** The instance allows registration and the address is on a managed
 *    mail domain.
 *
 * A closed instance with at least one user is closed. Registration is never a
 * way to gain a role: bootstrap yields `admin` because it *is* the configured
 * administrator, and open registration always yields `user`.
 */

export type RegistrationDecision =
  | {
      readonly allowed: true;
      readonly mode: "bootstrap" | "open";
      readonly role: "admin" | "user";
    }
  | { readonly allowed: false; readonly reason: string };

/** How many accounts exist. Zero means the instance has never been claimed. */
export async function countUsers(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length;
}

export async function evaluateRegistration(email: string): Promise<RegistrationDecision> {
  const normalized = email.trim().toLowerCase();
  const isClaimingInstance = (await countUsers()) === 0;

  if (isClaimingInstance) {
    // Naming the restriction is safe *only* here: with no accounts there is no
    // identity to enumerate, and the operator needs to know to check the ADMIN
    // setting. Once any account exists, every rejection is generic.
    if (normalized !== getAdminEmail().trim().toLowerCase()) {
      return {
        allowed: false,
        reason:
          "No accounts exist yet, so only the address in the ADMIN setting can register. Check that setting and try again.",
      };
    }
    return { allowed: true, mode: "bootstrap", role: "admin" };
  }

  const settings = await getInstanceSettings();

  if (settings.registrationMode === "closed") {
    return { allowed: false, reason: "Registration is closed on this instance." };
  }

  if (settings.registrationMode === "invite-only") {
    // No invitation model exists yet, so this is never reachable in practice.
    // Kept explicit rather than folded into "closed" so the gap is visible.
    return { allowed: false, reason: "Registration requires an invitation." };
  }

  // allowlist
  if (!isManagedAddress(normalized)) {
    // Generic: whether the address or the domain is wrong is not told apart,
    // because that distinction would make this an oracle for who has an account.
    return { allowed: false, reason: "This address is not eligible to register." };
  }

  return { allowed: true, mode: "open", role: "user" };
}
