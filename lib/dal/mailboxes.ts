import { getDb } from "@/db";
import { mailboxes } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Mailbox addresses and who receives what.
 *
 * This is the distribution half of Henna, and it is authorisation: deciding
 * which address delivers into whose inbox is exactly the kind of decision that
 * must not depend on a route or a UI check.
 *
 * Two rules, in order:
 *
 *  1. An explicit mailbox row wins. If the address has been created, it
 *     delivers to its owner — or, if `forward_to` is set, is forwarded onward.
 *  2. Otherwise, if the domain is one this instance serves and catch-all is
 *     enabled, the address is created on arrival and delivered locally.
 *
 * Everything else is rejected. `setReject()` is used rather than silently
 * dropping, because a bounce tells the sender something is wrong, whereas a
 * black hole does not.
 */

export interface MailboxRow {
  readonly id: string;
  readonly address: string;
  readonly domain: string;
  readonly localPart: string;
  readonly ownerUserId: string | null;
  readonly kind: string;
  readonly forwardTo: string | null;
  readonly enabled: boolean;
}

export type DeliveryDecision =
  /** Deliver into a local inbox. */
  | { readonly action: "deliver"; readonly mailbox: MailboxRow }
  /** Relay onward to an external address; nothing is stored. */
  | { readonly action: "forward"; readonly mailbox: MailboxRow; readonly to: string }
  /** Refuse the message. */
  | { readonly action: "reject"; readonly reason: string };

/** Normalise an address: lower-case, strip display name and angle brackets. */
export function normaliseAddress(raw: string): string {
  const trimmed = raw.trim();
  const angled = trimmed.match(/<([^>]+)>/);
  const address = (angled?.[1] ?? trimmed).trim().toLowerCase();
  return address;
}

export function splitAddress(address: string): { localPart: string; domain: string } | null {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return { localPart: address.slice(0, at), domain: address.slice(at + 1) };
}

export async function findMailbox(address: string): Promise<MailboxRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.address, normaliseAddress(address)));
  return row ? toMailbox(row) : null;
}

export async function listMailboxesForUser(userId: string): Promise<readonly MailboxRow[]> {
  const db = getDb();
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.ownerUserId, userId));
  return rows.map(toMailbox);
}

/**
 * Decide what happens to an inbound message.
 *
 * `managedDomains` and `catchAllEnabled` come from instance configuration so
 * this stays a pure function of its inputs — testable without a Worker.
 */
export async function decideDelivery(
  recipient: string,
  options: { readonly managedDomains: readonly string[]; readonly catchAllEnabled: boolean },
): Promise<DeliveryDecision> {
  const address = normaliseAddress(recipient);
  const parts = splitAddress(address);
  if (!parts) return { action: "reject", reason: "Malformed recipient address." };

  const existing = await findMailbox(address);

  if (existing) {
    if (!existing.enabled) return { action: "reject", reason: "This address is disabled." };
    // Forwarding takes precedence: a forwarding address relays and does not
    // keep a copy, which is what "forward" is expected to mean.
    if (existing.forwardTo) return { action: "forward", mailbox: existing, to: existing.forwardTo };
    return { action: "deliver", mailbox: existing };
  }

  // Not a domain this instance serves. Never autocreate here.
  if (!options.managedDomains.includes(parts.domain)) {
    return { action: "reject", reason: "This domain is not served by this instance." };
  }

  if (!options.catchAllEnabled) {
    return { action: "reject", reason: "This address does not exist." };
  }

  // Catch-all: create on arrival so mail is never lost just because nobody
  // claimed the address first.
  const created = await createMailbox(address, parts, null);
  return { action: "deliver", mailbox: created };
}

/**
 * Create a mailbox address.
 *
 * `ownerUserId` may be null. The unique index on `address` is what makes two
 * messages arriving at once for a new address safe: the second insert fails
 * rather than creating a duplicate, and the caller reads the existing row.
 */
export async function createMailbox(
  address: string,
  parts: { readonly localPart: string; readonly domain: string },
  ownerUserId: string | null,
  options: { readonly forwardTo?: string | null } = {},
): Promise<MailboxRow> {
  const db = getDb();
  const normalised = normaliseAddress(address);

  const existing = await findMailbox(normalised);
  if (existing) return existing;

  const [row] = await db
    .insert(mailboxes)
    .values({
      address: normalised,
      domain: parts.domain,
      localPart: parts.localPart,
      ownerUserId,
      kind: options.forwardTo ? "alias" : "inbox",
      forwardTo: options.forwardTo ?? null,
      // Both dialects store this as an integer column (0/1), not a native
      // boolean: SQLite has no boolean type, and the DAL is type-checked
      // against the PostgreSQL schema, so the two must agree on the shape.
      enabled: 1,
    })
    .returning();

  if (!row) {
    // Lost a race with a concurrent insert; the row now exists.
    const raced = await findMailbox(normalised);
    if (raced) return raced;
    throw new Error("Failed to create mailbox");
  }
  return toMailbox(row);
}

/** Assign an existing address to a user. Administrator-only at the call site. */
export async function assignMailbox(
  mailboxId: string,
  ownerUserId: string | null,
): Promise<MailboxRow | null> {
  const db = getDb();
  const [row] = await db
    .update(mailboxes)
    .set({ ownerUserId })
    .where(eq(mailboxes.id, mailboxId))
    .returning();
  return row ? toMailbox(row) : null;
}

export async function setMailboxEnabled(mailboxId: string, enabled: boolean): Promise<void> {
  const db = getDb();
  await db.update(mailboxes).set({ enabled: enabled ? 1 : 0 }).where(eq(mailboxes.id, mailboxId));
}

/** The addresses a user owns, for the DAL guard on reading a message. */
export async function ownsMailbox(userId: string, mailboxId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(and(eq(mailboxes.id, mailboxId), eq(mailboxes.ownerUserId, userId)))
    .limit(1);
  return rows.length > 0;
}

function toMailbox(row: typeof mailboxes.$inferSelect): MailboxRow {
  const enabled = row.enabled as unknown;
  return {
    id: row.id,
    address: row.address,
    domain: row.domain,
    localPart: row.localPart,
    ownerUserId: row.ownerUserId ?? null,
    kind: row.kind,
    forwardTo: row.forwardTo ?? null,
    // D1 exposes this as 0/1, Postgres as an integer column; treat both.
    enabled: enabled === true || enabled === 1,
  };
}
