import type { Env } from '../env';
import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';
import { parseAddress } from './types';

/** Resend —— https://resend.com/docs/api-reference/emails/send-email */
export const resendProvider: MailProvider = {
  kind: 'resend',
  label: 'Resend',
  docs: 'https://resend.com/docs/api-reference/emails/send-email',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 're_xxxx' },
    { key: 'defaultFrom', label: '默认发件人', type: 'text', placeholder: 'no-reply@your.domain' },
  ],
  async send(mail, cfg, _env): Promise<SendResult> {
    const from = parseAddress(mail.from);
    const body: Record<string, unknown> = {
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to: mail.to,
      subject: mail.subject,
      html: mail.html ?? undefined,
      text: mail.text ?? undefined,
    };
    if (mail.cc?.length) body.cc = mail.cc;
    if (mail.bcc?.length) body.bcc = mail.bcc;
    if (mail.replyTo) body.reply_to = mail.replyTo;
    if (mail.attachments?.length) {
      body.attachments = mail.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_type: a.contentType,
      }));
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { success: false, provider: 'resend', error: json.message ?? `HTTP ${res.status}` };
    }
    return { success: true, provider: 'resend', id: json.id };
  },
};
