import { redirect } from "next/navigation";
import { getInstanceSettings } from "@/lib/config/settings";
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

export default async function RegisterPage() {
  try {
    const resolved = await resolveSessionFromCookies();
    if (resolved?.principal.mfaSatisfied) redirect("/inbox");
  } catch {
    // Not signed in; the form is what matters here.
  }

  const isBootstrap = (await countUsers()) === 0;
  const settings = await getInstanceSettings();

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
            : "Henna never stores your mail. Messages stay between your browser and your mail server."}
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
