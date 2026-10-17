import { describe, expect, it, vi } from "vitest";

/**
 * Registration policy.
 *
 * The role is the thing worth testing: it must come from the DAL decision and
 * never from anything a request can influence. Bootstrap is the only path that
 * yields an administrator, and it does so only when no account exists.
 */

const userCount = { value: 0 };
const settings = { registrationMode: "closed", passwordMinLength: 12 };

vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        limit: async () => (userCount.value === 0 ? [] : [{ id: "u1" }]),
      }),
    }),
  }),
}));

vi.mock("@/lib/config/env", () => ({
  getAdminEmail: () => "admin@example.com",
}));

vi.mock("@/lib/config/settings", () => ({
  getInstanceSettings: async () => settings,
}));

vi.mock("@/lib/config/domains", () => ({
  // Only addresses on the configured mail domains are managed.
  isManagedAddress: (email: string) => email.endsWith("@example.com"),
}));

const { evaluateRegistration, countUsers } = await import("@/lib/dal/registration");

describe("evaluateRegistration", () => {
  it("lets the configured administrator claim an empty instance", async () => {
    userCount.value = 0;
    const decision = await evaluateRegistration("ADMIN@example.com");
    expect(decision).toEqual({ allowed: true, mode: "bootstrap", role: "admin" });
  });

  it("rejects any other address while the instance is empty", async () => {
    userCount.value = 0;
    const decision = await evaluateRegistration("someone@example.com");
    expect(decision.allowed).toBe(false);
  });

  it("never grants admin once an account exists, even for the ADMIN address", async () => {
    // The dangerous case: ADMIN re-registering after the instance is claimed
    // must not be another way to get the role.
    userCount.value = 1;
    settings.registrationMode = "allowlist";
    const decision = await evaluateRegistration("admin@example.com");
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error("expected registration to be allowed");
    expect(decision.role).toBe("user");
    expect(decision.mode).toBe("open");
  });

  it("is closed to everyone once claimed", async () => {
    userCount.value = 1;
    settings.registrationMode = "closed";
    expect((await evaluateRegistration("new@example.com")).allowed).toBe(false);
  });

  it("requires a managed domain under allowlist", async () => {
    userCount.value = 1;
    settings.registrationMode = "allowlist";
    expect((await evaluateRegistration("someone@elsewhere.test")).allowed).toBe(false);
    expect((await evaluateRegistration("someone@example.com")).allowed).toBe(true);
  });

  it("reports an empty instance as unclaimed", async () => {
    userCount.value = 0;
    expect(await countUsers()).toBe(0);
    userCount.value = 1;
    expect(await countUsers()).toBe(1);
  });
});
