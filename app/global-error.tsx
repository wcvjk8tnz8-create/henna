/**
 * Last-resort error boundary.
 *
 * Renders when an error escapes the root layout — which includes the very
 * failures that are easiest to hit on a fresh deploy: an unreadable binding, a
 * missing root variable, a schema that could not be created. Without this, all
 * of those produce a completely blank page and the deploy looks broken for
 * reasons nobody can see.
 *
 * This is the one place that may name the cause. It is rendered server-side and
 * never carries user input; a blank page helps nobody debug their own instance.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const digest = typeof error.digest === "string" ? error.digest : null;

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#f5f5f5",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "1.5rem",
        }}
      >
        <main style={{ maxWidth: "34rem", width: "100%" }}>
          <h1 style={{ fontSize: "1.25rem", margin: "0 0 0.75rem" }}>Henna could not start</h1>
          <p style={{ margin: "0 0 1rem", lineHeight: 1.6, color: "#d4d4d4" }}>
            Something failed before the page could render. The most common cause on a new
            deployment is a root variable that is missing or malformed, or a database binding
            that the Worker cannot reach.
          </p>
          <pre
            style={{
              margin: 0,
              padding: "0.75rem",
              background: "#171717",
              border: "1px solid #404040",
              borderRadius: "0.5rem",
              overflowX: "auto",
              fontSize: "0.8rem",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
            }}
          >
            {error.message || "Unknown error"}
            {digest ? `\n\ndigest: ${digest}` : ""}
          </pre>
          <p style={{ margin: "1rem 0 0", fontSize: "0.85rem", color: "#a3a3a3" }}>
            Check <code>DOMAIN</code>, <code>ADMIN</code> and <code>jwt_secret</code> under
            Worker → Settings → Variables and Secrets, then redeploy.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 0.9rem",
              borderRadius: "0.5rem",
              border: "1px solid #525252",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
