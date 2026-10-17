"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { buildRequestContext } from "@/lib/request";
import { hashPassword } from "@/lib/crypto/password";
import { consumeRateLimit, RATE_LIMIT_RULES } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/events";
import { getInstanceSettings } from "@/lib/config/settings";
import { evaluatePasswordPolicy, type PasswordVerdict } from "@/lib/dal/policy";
import { evaluateRegistration } from "@/lib/dal/registration";
import { createUser } from "@/lib/dal/users";
import { parseInput, registrationSchema, formDataToObject } from "@/lib/validation/schemas";

/**
 * Self-service registration.
 *
 * The decision is made entirely by `evaluateRegistration()` in the DAL; this
 * file only carries out what it permits. In particular the role is never taken
 * from the request — a form field saying `role=admin` must not be able to
 * produce an administrator.
 */

/**
 * Shape required by `useActionState`: the previous state goes in, the new state
 * comes out. The form posts to the Server Action directly rather than through a
 * client wrapper, so it still submits when JavaScript has not loaded.
 */
export interface RegisterState {
  readonly message: string | null;
}

export const initialRegisterState: RegisterState = { message: null };

const REGISTRATION_RULES = [
  { scope: "register:ip", limit: 10, windowSeconds: 3600, blockSeconds: 3600 },
  { scope: "register:email", limit: 5, windowSeconds: 3600, blockSeconds: 3600 },
];

async function context() {
  return buildRequestContext(await headers());
}

/**
 * Password policy failures are described, not just rejected.
 *
 * A password rule is the one credential policy a user can act on immediately,
 * and "invalid password" with no detail is a well-known source of abandoned
 * sign-ups. None of this reveals anything about another account.
 */
const PASSWORD_REASONS: Record<string, (min: number) => string> = {
  "too-short": (min) => `Use at least ${min} characters.`,
  "too-long": () => "Use at most 128 characters.",
  "no-letter": () => "Include at least one letter.",
  "no-digit": () => "Include at least one number.",
  "no-symbol": () => "Include at least one symbol.",
};

export async function registerAction(
  _previous: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = parseInput(registrationSchema, formDataToObject(formData));
  if (!parsed.ok) {
    return { message: parsed.issues[0] ?? "Check the details and try again." };
  }

  const ctx = await context();

  // Two axes, as with sign-in: spreading attempts across addresses or across
  // source IPs must not defeat the limit.
  for (const rule of REGISTRATION_RULES) {
    const subject = rule.scope.endsWith(":email")
      ? parsed.value.email.trim().toLowerCase()
      : (ctx.ipHash ?? "unknown");
    const verdict = await consumeRateLimit(rule, subject);
    if (!verdict.allowed) {
      await writeAudit({
        action: AUDIT_ACTIONS.ACCOUNT_CREATED,
        result: "denied",
        actorEmail: parsed.value.email,
        resourceType: "account",
        metadata: { reason: "rate-limited", scope: rule.scope },
        ipHash: ctx.ipHash,
        userAgentHash: ctx.userAgentHash,
      });
      return {
        message: `Too many attempts. Try again in ${verdict.retryAfterSeconds ?? 60} seconds.`,
      };
    }
  }

  const settings = await getInstanceSettings();
  const policy: PasswordVerdict = evaluatePasswordPolicy(parsed.value.password, {
    minLength: settings.passwordMinLength,
    requireComplexity: settings.passwordRequireComplexity,
  });
  if (!policy.ok) {
    return {
      message:
        PASSWORD_REASONS[policy.reason]?.(settings.passwordMinLength) ??
        "That password does not meet the policy.",
    };
  }

  const decision = await evaluateRegistration(parsed.value.email);
  if (!decision.allowed) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCOUNT_CREATED,
      result: "denied",
      actorEmail: parsed.value.email,
      resourceType: "account",
      metadata: { reason: decision.reason },
      ipHash: ctx.ipHash,
      userAgentHash: ctx.userAgentHash,
    });
    return { message: decision.reason };
  }

  const passwordHash = await hashPassword(parsed.value.password);

  // The unique index on email is what makes a concurrent double claim fail
  // rather than create a second administrator.
  const db = getDb();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.value.email.trim().toLowerCase()));
  if (existing.length > 0) {
    return { message: "That address is already registered." };
  }

  try {
    await createUser({
      email: parsed.value.email.trim().toLowerCase(),
      // From the decision, never from the request.
      role: decision.role,
      verified: true,
      passwordHash,
    });
  } catch {
    // Almost always the unique index: someone else claimed it first.
    return { message: "That address is already registered." };
  }

  await writeAudit({
    action: AUDIT_ACTIONS.ACCOUNT_CREATED,
    result: "success",
    actorEmail: parsed.value.email.trim().toLowerCase(),
    resourceType: "account",
    metadata: { mode: decision.mode, role: decision.role },
    ipHash: ctx.ipHash,
    userAgentHash: ctx.userAgentHash,
  });

  redirect("/login?registered=1");
}
