/**
 * Route-level error boundary.
 *
 * Without this, a failure inside a page renders nothing at all — which on a
 * deployed Worker is indistinguishable from a successful blank page, and gives
 * whoever is debugging no starting point.
 *
 * The message is shown because this runs server-side and carries no user input.
 * A digest is also rendered so the specific occurrence can be matched against
 * the Worker's logs.
 */

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const digest = typeof error.digest === "string" ? error.digest : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6 py-12">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        This page could not be rendered.
      </p>
      <pre className="mt-4 overflow-x-auto rounded-md border border-neutral-300 bg-neutral-100 p-3 text-xs leading-relaxed whitespace-pre-wrap dark:border-neutral-700 dark:bg-neutral-900">
        {error.message || "Unknown error"}
        {digest ? `\n\ndigest: ${digest}` : ""}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-4 w-fit rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700"
      >
        Try again
      </button>
    </main>
  );
}
