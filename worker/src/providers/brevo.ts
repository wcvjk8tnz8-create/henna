import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';

/** Brevo（原 Sendinblue）—— POST /v3/smtp/email */
export const brevoProvider: MailProvider = {
  kind: 'brevo',
  label: 'Brevo',
  docs: 'https://developers.brevo.com/reference/sendtransacemail',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'xkeysib-xxxx' },
    { key: 'defaultFrom', label: '默认发件人', type: 'text' },
  ],
  async send(mail, cfg): Promise<SendResult> {
    const body: Record<string, unknown> = {
      sender: { email: mail.from, name: undefined },
      to: mail.to.map((e) => ({ email: e })),
      subject: mail.subject,
      htmlContent: mail.html ?? undefined,
      textContent: mail.text ?? undefined,
    };
    if (mail.cc?.length) body.cc = mail.cc.map((e) => ({ email: e }));
    if (mail.bcc?.length) body.bcc = mail.bcc.map((e) => ({ email: e }));
    if (mail.replyTo) body.replyTo = { email: mail.replyTo };
    if (mail.attachments?.length) {
      body.attachment = mail.attachments.map((a) => ({
        name: a.filename,
        content: a.content,
      }));
    }
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': cfg.apiKey ?? '',
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string };
    if (!res.ok) {
      return { success: false, provider: 'brevo', error: json.message ?? `HTTP ${res.status}` };
    }
    return { success: true, provider: 'brevo', id: json.messageId };
  },
};
