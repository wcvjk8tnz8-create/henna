import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';
import { parseAddress } from './types';

/** Mailgun —— 支持 US / EU 区域 */
export const mailgunProvider: MailProvider = {
  kind: 'mailgun',
  label: 'Mailgun',
  docs: 'https://documentation.mailgun.com/docs/mailgun/api-reference/send-messages/',
  fields: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    { key: 'domain', label: 'Sending Domain', type: 'text', required: true, placeholder: 'mg.your.domain' },
    {
      key: 'region',
      label: '区域',
      type: 'select',
      required: true,
      options: [
        { label: 'US', value: 'us' },
        { label: 'EU', value: 'eu' },
      ],
      hint: 'eu 会自动使用 api.eu.mailgun.net',
    },
  ],
  async send(mail, cfg): Promise<SendResult> {
    const base = cfg.region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const from = parseAddress(mail.from);
    const form = new URLSearchParams();
    form.set('from', from.name ? `${from.name} <${from.email}>` : from.email);
    for (const t of mail.to) form.append('to', t);
    for (const t of mail.cc ?? []) form.append('cc', t);
    for (const t of mail.bcc ?? []) form.append('bcc', t);
    form.set('subject', mail.subject);
    if (mail.text) form.set('text', mail.text);
    if (mail.html) form.set('html', mail.html);
    if (mail.replyTo) form.set('h:Reply-To', mail.replyTo);

    const res = await fetch(`${base}/v3/${cfg.domain}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`api:${cfg.apiKey}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { success: false, provider: 'mailgun', error: json.message ?? `HTTP ${res.status}` };
    }
    return { success: true, provider: 'mailgun', id: json.id };
  },
};
