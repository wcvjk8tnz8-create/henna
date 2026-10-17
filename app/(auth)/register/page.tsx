import { redirect } from "next/navigation";
import { getSafeInstanceSettings } from "@/lib/config/settings";
import { countUsers } from "@/lib/dal/registration";
import { resolveSessionFromCookies } from "@/lib/dal/session";
import { RegisterForm } from "./register-form";

/**
 * Registration page.
 *
 * Rendered whenever registration is possible — which, on a fresh instance, is
 * the only way to get in at all: the `ADMIN` setting names the administrator's
 * address but never carries a credential, so the account has to be claimed
 * here with a password before anyone can sign in.
 *
 * Whether an address may actually register is decided in the DAL, not here.
 * This page only decides whether to offer the form.
 */

export const metadata = { title: "Create account" };

/**
 * Never prerendered.
 *
 * This page reads the database to decide whether it can offer registration, and
 * at build time there is no database: no D1 binding, no DATABASE_URL, no
 * Hyperdrive. Next tried to prerender it anyway and the build died with
 * "No database configured" — a build-time failure for a runtime-only reason.
 *
 * Every page that reads the database needs this. The UI is per-user and
 * authenticated anyway, so there is nothing here worth prerendering.
 */
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  try {
    const resolved = await resolveSessionFromCookies();
    if (resolved?.principal.mfaSatisfied) redirect("/inbox");
  } catch {
    // Not signed in; the form is what matters here.
  }

  // Both reads can fail, and neither should turn the page into an error.
  const isBootstrap = await isUnclaimed();
  const settings = await getSafeInstanceSettings();

  // Closed and already claimed: nothing to offer, so don't advertise it.
  if (!isBootstrap && settings.registrationMode === "closed") {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="henna-enter">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isBootstrap ? "Create the administrator account" : "Create account"}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {isBootstrap
            ? "Your instance has no accounts yet. Set a password to claim it."
            : "Claim an address on this instance."}
        </p>

        <RegisterForm
          passwordMinLength={settings.passwordMinLength}
          requireComplexity={settings.passwordRequireComplexity}
          isBootstrap={isBootstrap}
        />

        <p className="mt-6 text-sm text-neutral-600 dark:text-neutral-400">
          Already have an account?{" "}
          <a href="/login" className="underline">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}

/**
 * True when the instance appears to have no accounts yet.
 *
 * Falls back to true: if the database cannot be read we cannot prove the
 * instance is claimed, and registration is the only way into a fresh one.
 * A wrong address is then rejected by the DAL, which is the right place.
 */
async function isUnclaimed(): Promise<boolean> {
  try {
    return (await countUsers()) === 0;
  } catch {
    return true;
  }
}

