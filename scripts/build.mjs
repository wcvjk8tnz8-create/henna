#!/usr/bin/env node
/**
 * Build entry point that works both ways round.
 *
 * `opennextjs-cloudflare build` does not run `next build` directly — it runs
 * the project's own `build` script. So naming that script
 * `opennextjs-cloudflare build` makes it call itself, forever. That is exactly
 * what happened: the build log repeated "OpenNext — Cloudflare build" until it
 * was killed.
 *
 * This script breaks the cycle with a guard variable:
 *
 *   - top level  -> run `opennextjs-cloudflare build`, with HENNA_OPENNEXT_CHILD=1
 *   - as a child -> HENNA_OPENNEXT_CHILD is set, so run `next build` instead
 *
 * The result is that `npm run build` is the one command that works everywhere:
 * in the Cloudflare dashboard, in CI, and when OpenNext invokes it internally.
 *
 * Set HENNA_BUILD_PLAN=1 to print the command instead of running it, which is
 * how the unit test asserts the branch without spawning a real build.
 */

import { spawnSync } from "node:child_process";

const CHILD_FLAG = "HENNA_OPENNEXT_CHILD";
const TARGET_FLAG = "HENNA_BUILD_TARGET";

function command() {
  return process.env[CHILD_FLAG] === "1"
    ? { file: "next", args: ["build", "--turbopack"] }
    : { file: "npx", args: ["--no-install", "opennextjs-cloudflare", "build"] };
}

export function plan(env = process.env) {
  if (env[CHILD_FLAG] === "1") return `${TARGET_FLAG}=workers next build --turbopack`;
  return "opennextjs-cloudflare build";
}

function main() {
  const { file, args } = command();

  if (process.env.HENNA_BUILD_PLAN === "1") {
    // Print what would run, including the target flag, so the tests assert the
    // decision without spawning a build.
    console.log(
      `${TARGET_FLAG}=${process.env[CHILD_FLAG] === "1" ? "workers" : "node"} ` +
        [file, ...args].join(" "),
    );
    return;
  }

  const env = { ...process.env };
  if (env[CHILD_FLAG] !== "1") {
    env[CHILD_FLAG] = "1";
    env[TARGET_FLAG] = "workers";
  } else {
    // Reached as OpenNext's child: the Next build feeding a Worker bundle, so
    // next.config.ts must stub out Node-only packages such as pg.
    env[TARGET_FLAG] = "workers";
  }

  const result = spawnSync(file, args, { stdio: "inherit", env, shell: process.platform === "win32" });
  process.exit(result.status ?? 1);
}

main();
