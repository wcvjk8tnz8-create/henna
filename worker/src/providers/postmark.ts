import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';

/** Postmark —— POST /email */
export const postmarkProvider: MailProvider = {
  kind: 'postmark',
  label: 'Postmark',
  docs: 'https://postmarkapp.com/developer/api/email-api',
  fields: [
    { key: 'apiKey', label: 'Server Token', type: 'password', required: true },
    { key: 'defaultFrom', label: '默认发件人', type: 'text' },
  ],
  async send(mail, cfg): Promise<SendResult> {
    const body: Record<string, unknown> = {
      From: mail.from,
      To: mail.to.join(','),
      Subject: mail.subject,
      HtmlBody: mail.html ?? undefined,
      TextBody: mail.text ?? undefined,
      MessageStream: 'outbound',
    };
    if (mail.cc?.length) body.Cc = mail.cc.join(',');
    if (mail.bcc?.length) body.Bcc = mail.bcc.join(',');
    if (mail.replyTo) body.ReplyTo = mail.replyTo;
    if (mail.attachments?.length) {
      body.Attachments = mail.attachments.map((a) => ({
        Name: a.filename,
        Content: a.content,
        ContentType: a.contentType ?? 'application/octet-stream',
      }));
    }
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'X-Postmark-Server-Token': cfg.apiKey ?? '',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      MessageID?: string;
      ErrorCode?: number;
      Message?: string;
    };
    if (!res.ok || json.ErrorCode) {
      return { success: false, provider: 'postmark', error: json.Message ?? `HTTP ${res.status}` };
    }
    return { success: true, provider: 'postmark', id: json.MessageID };
  },
};
