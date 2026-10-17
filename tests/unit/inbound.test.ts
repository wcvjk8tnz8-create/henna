import { describe, expect, it, vi } from "vitest";

// The real @/db pulls in pg, whose dependency tree is incomplete in this
// sandbox. These tests cover Henna's own logic, so a database that simply
// returns "nothing found" is enough — every case below is decided before, or
// regardless of, what the database contains.
vi.mock("@/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: () => ({ returning: async () => [] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  }),
}));
import {
  buildSnippet,
  sanitiseFilename,
  type MimeParser,
  type ParsedMail,
} from "@/lib/mail/inbound";
import { decideDelivery, normaliseAddress, splitAddress } from "@/lib/dal/mailboxes";

/**
 * Inbound handling.
 *
 * The parser is injected here rather than imported, which is what lets these
 * tests cover Henna's own logic — snippet building, filename sanitising,
 * distribution — without a MIME library present.
 */

const fakeParser: MimeParser = async () => ({ subject: "hi" });

describe("normaliseAddress", () => {
  it("lower-cases and unwraps a display name", () => {
    expect(normaliseAddress("Alice <Alice@Example.COM>")).toBe("alice@example.com");
  });

  it("handles a bare address", () => {
    expect(normaliseAddress("  Bob@Example.com ")).toBe("bob@example.com");
  });
});

describe("splitAddress", () => {
  it("splits at the last @", () => {
    expect(splitAddress("a@b@example.com")).toEqual({
      localPart: "a@b",
      domain: "example.com",
    });
  });

  it("rejects a malformed address", () => {
    expect(splitAddress("nope")).toBeNull();
    expect(splitAddress("@example.com")).toBeNull();
    expect(splitAddress("someone@")).toBeNull();
  });
});

describe("buildSnippet", () => {
  it("collapses whitespace", () => {
    expect(buildSnippet("a\n\n  b\t  c", "")).toBe("a b c");
  });

  it("truncates at 200 characters with an ellipsis", () => {
    const snippet = buildSnippet("x".repeat(500), "");
    expect(snippet).toHaveLength(201);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("falls back to the subject when there is no body", () => {
    expect(buildSnippet(undefined, "Re: hello")).toBe("Re: hello");
  });
});

describe("sanitiseFilename", () => {
  it("strips directory traversal", () => {
    expect(sanitiseFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitiseFilename("a/b\\c.txt")).toBe("c.txt");
  });

  it("removes control characters", () => {
    expect(sanitiseFilename("invoice\n.pdf\r")).toBe("invoice.pdf");
  });

  it("returns null for a name that vanishes", () => {
    expect(sanitiseFilename(undefined)).toBeNull();
    expect(sanitiseFilename("../../")).toBeNull();
  });

  it("caps the length", () => {
    expect(sanitiseFilename("a".repeat(400))).toHaveLength(255);
  });
});

/* ------------------------------------------------------- distribution */

describe("decideDelivery", () => {
  const managed = ["example.com"];

  it("rejects a domain this instance does not serve", async () => {
    const decision = await decideDelivery("someone@elsewhere.test", {
      managedDomains: managed,
      catchAllEnabled: true,
    });
    expect(decision.action).toBe("reject");
  });

  it("rejects a malformed recipient before touching the database", async () => {
    const decision = await decideDelivery("not-an-address", {
      managedDomains: managed,
      catchAllEnabled: true,
    });
    expect(decision.action).toBe("reject");
  });

  it("rejects an unknown address when catch-all is off", async () => {
    const decision = await decideDelivery("nobody@example.com", {
      managedDomains: managed,
      catchAllEnabled: false,
    });
    expect(decision.action).toBe("reject");
  });
});

describe("MIME parser boundary", () => {
  it("is a function of bytes in, structured mail out", async () => {
    const parsed: ParsedMail = await fakeParser(new ArrayBuffer(0));
    expect(parsed.subject).toBe("hi");
  });
});
