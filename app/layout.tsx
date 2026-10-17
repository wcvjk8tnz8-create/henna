import { ensureSchema } from "@/db";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Henna",
    template: "%s · Henna",
  },
  description:
    "Henna is a security-first, self-hostable webmail frontend. Your mail never touches Henna's server.",
  // Mail content must never be indexed or previewed by a crawler.
  robots: { index: false, follow: false },
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Creates the schema on first request when running on D1.
 *
 * Deliberately non-fatal. This runs for *every* route, so throwing here turns
 * any database problem into a blank page on every URL — the worst possible
 * failure mode, because the operator cannot tell a broken instance from a
 * working one. Individual pages surface their own data errors instead.
 */
async function tryEnsureSchema(): Promise<string | null> {
  try {
    await ensureSchema();
    return null;
  } catch (error) {
    console.error(
      "[henna] schema bootstrap failed:",
      error instanceof Error ? error.message : String(error),
    );
    return error instanceof Error ? error.message : String(error);
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const schemaError = await tryEnsureSchema();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-full">
        {children}
        {schemaError ? (
          // Server-rendered, so it is visible even if client JS never loads —
          // which is the situation it exists to describe.
          <div
            role="alert"
            style={{
              position: "fixed",
              inset: "auto 0 0 0",
              padding: "0.75rem 1rem",
              background: "#7f1d1d",
              color: "#fff",
              font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            Database unavailable: {schemaError}
          </div>
        ) : null}
      </body>
    </html>
  );
}
