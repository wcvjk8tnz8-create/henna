import type { EmailProviderId } from "@/lib/config/schema";

/**
 * Outbound mail providers.
 *
 * Henna only ever sends transactional mail: sign-in codes and password resets.
 * Three providers are supported because a single one is not usable by
 * everyone — Resend, which was the original choice, refuses domains that appear
 * on the Public Suffix List (PSL). A domain like `example.co.uk` or
 * `project.github.io` cannot be added to Resend at all, which makes Henna
 * unusable for anyone whose mail domain is one of them. Brevo and Mailjet both
 * accept such domains, so an instance can pick whichever works for its domain.
 *
 * Deliberately *not* abstracted behind a generic "SMTP" provider: IMAP/SMTP is
 * Henna's inbound/mail-client path, and mixing the deployment's outbound
 * transactional mail into it would put the credentials that send login codes in
 * the same place as the ones that read someone's mailbox.
 *
 * There is no SDK. Each provider is one `fetch` call, which keeps the Workers
 * bundle small and the failure modes visible.
 */

export interface OutboundMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface SendResult {
  readonly ok: boolean;
  readonly provider: EmailProviderId;
  /** Safe to log: the provider's own message, never the message body. */
  readonly detail: string;
}

export interface ProviderConfig {
  readonly from: string;
  readonly resendApiKey: string | null;
  /** Brevo uses a single key; Mailjet uses a key and a secret. */
  readonly brevoApiKey: string | null;
  readonly mailjetApiKey: string | null;
  readonly mailjetSecretKey: string | null;
}

export class EmailSendError extends Error {
  override readonly name = "EmailSendError";
  readonly provider: EmailProviderId;
  readonly status: number | null;

  constructor(provider: EmailProviderId, message: string, status: number | null = null) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

/** `Henna <no-reply@example.com>` -> `{ name, address }`. */
export function splitFrom(from: string): { name: string; address: string } {
  const trimmed = from.trim();
  const match = /^\s*(.+?)\s*<([^>]+)>\s*$/.exec(trimmed);
  if (match?.[1] && match[2]) {
    return { name: match[1], address: match[2].trim() };
  }
  return { name: "Henna", address: trimmed };
}

async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

/** Pull a human-readable reason out of a provider's error response. */
async function failureDetail(response: Response): Promise<string> {
  const status = response.status;
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    // A non-JSON error body is common behind a proxy; the status is enough.
  }
  const message =
    typeof parsed === "object" && parsed !== null
      ? String((parsed as { message?: unknown }).message ?? "")
      : "";
  return message ? `${status}: ${message}` : `${status}: request rejected`;
}

const ENDPOINTS: Record<EmailProviderId, string> = {
  resend: "https://api.resend.com/emails",
  brevo: "https://api.brevo.com/v3/smtp/email",
  mailjet: "https://api.mailjet.com/v3.1/send",
};

async function sendWithResend(
  config: ProviderConfig,
  message: OutboundMessage,
): Promise<SendResult> {
  if (!config.resendApiKey) {
    throw new EmailSendError("resend", "No Resend API key configured");
  }
  const { name, address } = splitFrom(config.from);
  const response = await post(
    ENDPOINTS.resend,
    { authorization: `Bearer ${config.resendApiKey}` },
    {
      from: name ? `${name} <${address}>` : address,
      to: message.to,
      subject: message.subject,
      text: message.text,
    },
  );
  if (!response.ok) {
    throw new EmailSendError("resend", await failureDetail(response), response.status);
  }
  return { ok: true, provider: "resend", detail: "accepted" };
}

async function sendWithBrevo(
  config: ProviderConfig,
  message: OutboundMessage,
): Promise<SendResult> {
  if (!config.brevoApiKey) {
    throw new EmailSendError("brevo", "No Brevo API key configured");
  }
  const { name, address } = splitFrom(config.from);
  const response = await post(
    ENDPOINTS.brevo,
    { "api-key": config.brevoApiKey },
    {
      sender: { name: name || address, email: address },
      to: [{ email: message.to }],
      subject: message.subject,
      textContent: message.text,
    },
  );
  if (!response.ok) {
    throw new EmailSendError("brevo", await failureDetail(response), response.status);
  }
  return { ok: true, provider: "brevo", detail: "accepted" };
}

async function sendWithMailjet(
  config: ProviderConfig,
  message: OutboundMessage,
): Promise<SendResult> {
  if (!config.mailjetApiKey || !config.mailjetSecretKey) {
    throw new EmailSendError("mailjet", "Mailjet needs both an API key and a secret key");
  }
  const { name, address } = splitFrom(config.from);
  // Mailjet takes HTTP Basic with the key as the user and the secret as the
  // password. btoa is available on Workers and on Node 16+.
  const basic = btoa(`${config.mailjetApiKey}:${config.mailjetSecretKey}`);
  const response = await post(
    ENDPOINTS.mailjet,
    { authorization: `Basic ${basic}` },
    {
      Messages: [
        {
          From: { Email: address, Name: name || address },
          To: [{ Email: message.to }],
          Subject: message.subject,
          TextPart: message.text,
        },
      ],
    },
  );
  if (!response.ok) {
    throw new EmailSendError("mailjet", await failureDetail(response), response.status);
  }
  return { ok: true, provider: "mailjet", detail: "accepted" };
}

/**
 * Send through whichever provider the instance is configured for.
 *
 * The message body is never logged or returned — `detail` carries only the
 * provider's own status, so a failure can be surfaced to an administrator
 * without leaking a sign-in code.
 */
export async function sendMail(
  provider: EmailProviderId,
  config: ProviderConfig,
  message: OutboundMessage,
): Promise<SendResult> {
  switch (provider) {
    case "resend":
      return sendWithResend(config, message);
    case "brevo":
      return sendWithBrevo(config, message);
    case "mailjet":
      return sendWithMailjet(config, message);
    default:
      // Unreachable while provider is validated by Zod. Throwing rather than
      // returning keeps TypeScript honest if a fourth provider is ever added
      // and a call site is missed.
      throw new EmailSendError(provider, `No implementation for provider "${provider}"`);
  }
}

/**
 * Whether a provider's credentials are complete enough to attempt a send.
 *
 * Used to decide between "send it" and "fall back to the bootstrap log path",
 * and to tell an administrator which field is still missing.
 */
export function missingCredentials(
  provider: EmailProviderId,
  config: ProviderConfig,
): readonly string[] {
  if (!config.from) return ["emailFrom"];
  switch (provider) {
    case "resend":
      return config.resendApiKey ? [] : ["resendApiKey"];
    case "brevo":
      return config.brevoApiKey ? [] : ["brevoApiKey"];
    case "mailjet":
      return [
        ...(config.mailjetApiKey ? [] : ["mailjetApiKey"]),
        ...(config.mailjetSecretKey ? [] : ["mailjetSecretKey"]),
      ];
    default:
      return ["emailProvider"];
  }
}
