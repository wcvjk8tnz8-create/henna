import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicInstanceSettings } from "@/lib/config/settings";
import { getMailDomains } from "@/lib/config/env";
import { resolveSessionFromCookies } from "@/lib/dal/session";
import { LoginForm } from "./login-form";

/**
 * Sign-in page.
 *
 * Only the three supported methods are offered, and only those the instance has
 * switched on. There is no "forgot which provider" hint and no account
 * enumeration: an unknown address produces the same response as a valid one.
 */
export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ readonly error?: string; readonly next?: string }>;
}) {
  const params = await searchParams;

  // Already signed in (and through MFA): straight to the inbox. A failure here
  // must not prevent the page from rendering — see `boot` below.
  try {
    const resolved = await resolveSessionFromCookies();
    if (resolved?.principal.mfaSatisfied) {
      redirect("/inbox");
    }
  } catch {
    // Not signed in as far as this page is concerned.
  }

  // The sign-in page must render even when the database does not. Otherwise a
  // fresh deploy with a broken binding is a blank page, which tells the operator
  // nothing and cannot be debugged from the outside.
  const boot = await loadBootState();
  const settings = boot.settings;
  const jar = await cookies();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <div className="henna-enter">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Henna</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Henna never stores your mail. Messages stay between your browser and your mail server.
        </p>

        {boot.problem ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            This instance could not read its settings, so only password sign-in is offered.
            <span className="mt-1 block font-mono text-xs opacity-80">{boot.problem}</span>
          </p>
        ) : null}

        {params.error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          >
            {describeError(params.error)}
          </p>
        ) : null}

        <LoginForm
          methods={[...settings.authMethods]}
          passwordMinLength={settings.passwordMinLength}
          otpCooldownSeconds={settings.otpResendCooldownSeconds}
          githubEnabled={settings.githubConfigured}
          emailOtpEnabled={settings.authMethods.includes("email_otp") && settings.resendConfigured}
          hasPendingMfa={Boolean(jar.get("henna_pending_mfa")?.value)}
          nextPath={params.next ?? "/inbox"}
        />
      </div>
    </main>
  );
}

/**
 * Instance settings, or a safe fallback plus the reason they are unavailable.
 *
 * Password sign-in stays offered when settings cannot be read, because it is
 * the one method that needs no external service. Everything else is switched
 * off rather than advertised and then failing.
 */
async function loadBootState(): Promise<{
  settings: Awaited<ReturnType<typeof getPublicInstanceSettings>>;
  problem: string | null;
}> {
  try {
    return { settings: await getPublicInstanceSettings(getMailDomains()), problem: null };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    console.error("[henna] could not read instance settings:", problem);
    return {
      settings: {
        authMethods: ["password"],
        registrationMode: "closed",
        totpPolicy: "admin-only",
        passwordMinLength: 12,
        passwordRequireComplexity: true,
        otpTtlSeconds: 600,
        otpResendCooldownSeconds: 60,
        transitionsEnabled: false,
        respectReducedMotion: true,
        githubConfigured: false,
        resendConfigured: false,
        mailDomains: [],
      },
      problem,
    };
  }
}

function describeError(code: string): string {
  switch (code) {
    case "denied":
      return "Your account cannot sign in right now. Contact an administrator.";
    case "locked":
      return "Too many attempts. Try again later.";
    case "mfa":
      return "Complete your second factor to continue.";
    default:
      // Deliberately generic: a specific message would be an oracle.
      return "We could not sign you in. Check your details and try again.";
  }
}
