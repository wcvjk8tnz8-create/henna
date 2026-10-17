import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmailSendError,
  missingCredentials,
  sendMail,
  splitFrom,
  type ProviderConfig,
} from "@/lib/email/provider";
import { installTestEnv } from "./helpers/env";

/**
 * Outbound mail providers.
 *
 * Henna sends only transactional mail — sign-in codes and password resets — so
 * the surface under test is small but security-relevant: the right endpoint, the
 * right credential placement, and above all that a failure never carries the
 * code itself.
 */

beforeEach(() => {
  installTestEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BASE: ProviderConfig = {
  from: "Henna <no-reply@example.com>",
  resendApiKey: "re_test",
  brevoApiKey: "xkeysib-test",
  mailjetApiKey: "mj-key",
  mailjetSecretKey: "mj-secret",
};

const MESSAGE = { to: "user@example.com", subject: "Code", text: "123456" };

/** Capture the request a provider made, so assertions do not depend on the SDK. */
function stubFetch(status: number, body: unknown = {}): () => {
  url: string;
  init: RequestInit | undefined;
} {
  let captured: { url: string; init: RequestInit | undefined } = {
    url: "",
    init: undefined,
  };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return () => captured;
}

describe("splitFrom", () => {
  it("splits a display name from the address", () => {
    expect(splitFrom("Henna <no-reply@example.com>")).toEqual({
      name: "Henna",
      address: "no-reply@example.com",
    });
  });

  it("falls back to a bare address", () => {
    expect(splitFrom("no-reply@example.com")).toEqual({
      name: "Henna",
      address: "no-reply@example.com",
    });
  });

  it("trims whitespace", () => {
    expect(splitFrom("  Henna   <a@b.com>  ").address).toBe("a@b.com");
  });
});

describe("missingCredentials", () => {
  it("reports nothing when the chosen provider is fully configured", () => {
    expect(missingCredentials("resend", BASE)).toEqual([]);
    expect(missingCredentials("brevo", BASE)).toEqual([]);
    expect(missingCredentials("mailjet", BASE)).toEqual([]);
  });

  it("requires the sender address for every provider", () => {
    expect(missingCredentials("brevo", { ...BASE, from: "" })).toEqual(["emailFrom"]);
  });

  it("only asks for the credentials of the selected provider", () => {
    // Someone switching to Brevo should not be blocked by an empty Resend key.
    expect(missingCredentials("brevo", { ...BASE, resendApiKey: null })).toEqual([]);
    expect(missingCredentials("resend", { ...BASE, brevoApiKey: null })).toEqual([]);
  });

  it("needs both Mailjet values", () => {
    expect(missingCredentials("mailjet", { ...BASE, mailjetSecretKey: null })).toEqual([
      "mailjetSecretKey",
    ]);
  });
});

describe("sendMail", () => {
  it("uses the Resend endpoint with a bearer token", async () => {
    const captured = stubFetch(200);
    const result = await sendMail("resend", BASE, MESSAGE);

    expect(result.ok).toBe(true);
    expect(captured().url).toBe("https://api.resend.com/emails");
    const headers = captured().init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(captured().init?.body));
    expect(body.to).toBe("user@example.com");
    expect(body.text).toBe("123456");
  });

  it("uses the Brevo endpoint with an api-key header", async () => {
    const captured = stubFetch(201);
    await sendMail("brevo", BASE, MESSAGE);

    expect(captured().url).toBe("https://api.brevo.com/v3/smtp/email");
    const headers = captured().init?.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("xkeysib-test");
    const body = JSON.parse(String(captured().init?.body));
    expect(body.sender.email).toBe("no-reply@example.com");
    expect(body.to[0].email).toBe("user@example.com");
    expect(body.textContent).toBe("123456");
  });

  it("uses the Mailjet endpoint with basic auth", async () => {
    const captured = stubFetch(200);
    await sendMail("mailjet", BASE, MESSAGE);

    expect(captured().url).toBe("https://api.mailjet.com/v3.1/send");
    const headers = captured().init?.headers as Record<string, string>;
    // Mailjet authenticates with the API key as the user and the secret as the
    // password; btoa of "mj-key:mj-secret".
    expect(headers.authorization).toBe(`Basic ${btoa("mj-key:mj-secret")}`);
    const body = JSON.parse(String(captured().init?.body));
    expect(body.Messages[0].From.Email).toBe("no-reply@example.com");
    expect(body.Messages[0].TextPart).toBe("123456");
  });
});

describe("failure handling", () => {
  it("throws with the provider and status, never the message body", async () => {
    stubFetch(403, { message: "domain not verified" });

    await expect(sendMail("resend", BASE, MESSAGE)).rejects.toThrow(EmailSendError);
    try {
      await sendMail("resend", BASE, MESSAGE);
    } catch (error) {
      expect(error).toBeInstanceOf(EmailSendError);
      if (error instanceof EmailSendError) {
        expect(error.provider).toBe("resend");
        expect(error.status).toBe(403);
        expect(error.message).toContain("domain not verified");
        // The code must not leak into an error an administrator might read.
        expect(error.message).not.toContain("123456");
      }
    }
  });

  it("refuses to send without the selected provider's credential", async () => {
    stubFetch(200);
    await expect(
      sendMail("brevo", { ...BASE, brevoApiKey: null }, MESSAGE),
    ).rejects.toThrow(/No Brevo API key/);
    await expect(
      sendMail("mailjet", { ...BASE, mailjetSecretKey: null }, MESSAGE),
    ).rejects.toThrow(/both an API key and a secret key/);
  });

  it("survives a non-JSON error body", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>502 Bad Gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(sendMail("brevo", BASE, MESSAGE)).rejects.toThrow(/502/);
  });
});
