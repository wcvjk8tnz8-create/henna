import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';
import { parseAddress } from './types';

/** SendGrid —— POST /v3/mail/send */
export const sendgridProvider: MailProvider = {
  kind: 'sendgrid',
  label: 'SendGrid',
  docs: 'https://docs.sendgrid.com/api-reference/mail-send/mail-send',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true, placeholder: 'SG.xxxx' },
    { key: 'defaultFrom', label: '默认发件人', type: 'text' },
  ],
  async send(mail, cfg): Promise<SendResult> {
    const from = parseAddress(mail.from);
    const personalization: Record<string, unknown> = { to: mail.to.map((e) => ({ email: e })) };
    if (mail.cc?.length) personalization.cc = mail.cc.map((e) => ({ email: e }));
    if (mail.bcc?.length) personalization.bcc = mail.bcc.map((e) => ({ email: e }));

    const body: Record<string, unknown> = {
      personalizations: [personalization],
      from: { email: from.email, name: from.name },
      subject: mail.subject,
      content: [
        ...(mail.text ? [{ type: 'text/plain', value: mail.text }] : []),
        ...(mail.html ? [{ type: 'text/html', value: mail.html }] : []),
      ],
    };
    if (!mail.text && !mail.html) body.content = [{ type: 'text/plain', value: '' }];
    if (mail.replyTo) body.reply_to = { email: mail.replyTo };
    if (mail.attachments?.length) {
      body.attachments = mail.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        type: a.contentType ?? 'application/octet-stream',
        disposition: 'attachment',
      }));
    }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { success: false, provider: 'sendgrid', error: txt || `HTTP ${res.status}` };
    }
    return {
      success: true,
      provider: 'sendgrid',
      id: res.headers.get('x-message-id') ?? undefined,
    };
  },
};
