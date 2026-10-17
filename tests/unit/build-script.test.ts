import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * The recursion guard in scripts/build.mjs.
 *
 * Covered because getting it wrong is not a subtle bug: OpenNext runs the
 * project's own `build` script, so a `build` that points back at OpenNext loops
 * until the build is killed, and the deploy never happens.
 *
 * The script prints its plan instead of executing it when
 * HENNA_BUILD_PLAN=1, so this asserts the branch without spawning a build.
 */

const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../scripts/build.mjs");

function plan(env: Record<string, string>): string {
  return execFileSync(process.execPath, [script], {
    env: { ...process.env, HENNA_BUILD_PLAN: "1", ...env },
    encoding: "utf8",
  }).trim();
}

describe("scripts/build.mjs", () => {
  it("runs the OpenNext build at the top level", () => {
    expect(plan({ HENNA_OPENNEXT_CHILD: "" })).toContain("opennextjs-cloudflare build");
  });

  it("runs the plain Next build when invoked by OpenNext", () => {
    // This is the branch that stops the loop: the child must never call back
    // into OpenNext.
    const out = plan({ HENNA_OPENNEXT_CHILD: "1" });
    expect(out).toContain("next build");
    expect(out).not.toContain("opennextjs-cloudflare");
  });

  it("marks the Next build as a Workers build", () => {
    // next.config.ts reads this to stub out Node-only packages. Without it, pg
    // reaches the Worker bundle and the build dies on pg-cloudflare.
    expect(plan({ HENNA_OPENNEXT_CHILD: "1" })).toContain("HENNA_BUILD_TARGET=workers");
  });

  it("is stable across one level of nesting", () => {
    const top = plan({ HENNA_OPENNEXT_CHILD: "" });
    const child = plan({ HENNA_OPENNEXT_CHILD: "1" });
    expect(top).not.toBe(child);
    // A second call as a child stays a child — the flag is inherited, not
    // toggled, so there is no oscillation.
    expect(plan({ HENNA_OPENNEXT_CHILD: "1" })).toBe(child);
  });
});
