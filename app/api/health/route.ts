import { NextResponse } from "next/server";
import { tryGetRootConfig } from "@/lib/config/env";
import { getKeyRotationStatus } from "@/lib/crypto/keyring";

/**
 * Health and configuration check.
 *
 * Reports *why* an instance is unhealthy rather than only crashing: a missing
 * DOMAIN, an unreadable jwt_secret or a broken credential keyring each show up
 * here with their own message. No secret value is ever included.
 */
export async function GET() {
  const config = tryGetRootConfig();
  const rotation = getKeyRotationStatus();

  if (!config.ok) {
    return NextResponse.json(
      {
        status: "misconfigured",
        issues: config.error.issues,
        credentialKeyring: rotation.healthy ? "ok" : "unavailable",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      status: rotation.healthy ? "ok" : "degraded",
      // Domain names are not secret, but the admin address is only reported as
      // a boolean so the endpoint cannot be used to enumerate identities.
      domains: config.value.DOMAIN.length,
      adminConfigured: Boolean(config.value.ADMIN),
      jwtSecretConfigured: Boolean(config.value.jwt_secret),
      credentialKeyring: {
        activeKeyId: rotation.activeKeyId,
        keyCount: rotation.keyCount,
        healthy: rotation.healthy,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
