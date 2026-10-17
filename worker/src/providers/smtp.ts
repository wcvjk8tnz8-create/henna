import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';
import { parseAddress } from './types';

/**
 * 通用 SMTP-over-HTTP 中继。
 * Cloudflare Workers 无法直连 TCP 25/587，所以"SMTP 发信"走中继网关。
 * 默认适配 SMTP2GO，任何兼容 JSON 的中继改 endpoint 即可复用。
 */
export const smtpProvider: MailProvider = {
  kind: 'smtp',
  label: 'SMTP 中继',
  docs: 'https://developers.smtp2go.com/services/smtp2go-api/',
  fields: [
    {
      key: 'endpoint',
      label: '中继 Endpoint',
      type: 'text',
      required: true,
      placeholder: 'https://api.smtp2go.com/v3/email/send',
    },
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    { key: 'username', label: '用户名（可选）', type: 'text' },
    { key: 'password', label: '密码（可选）', type: 'password' },
    { key: 'host', label: 'SMTP Host（可选）', type: 'text', placeholder: 'mail.smtp2go.com' },
    { key: 'defaultFrom', label: '默认发件人', type: 'text' },
  ],
  async send(mail, cfg): Promise<SendResult> {
    const from = parseAddress(mail.from);
    const endpoint = cfg.endpoint || 'https://api.smtp2go.com/v3/email/send';
    const body: Record<string, unknown> = {
      api_key: cfg.apiKey,
      to: mail.to,
      sender: from.email,
      subject: mail.subject,
      text_body: mail.text ?? mail.html?.replace(/<[^>]+>/g, '') ?? '',
      html_body: mail.html ?? undefined,
    };
    if (from.name) body.sender_name = from.name;
    if (mail.cc?.length) body.cc = mail.cc;
    if (mail.bcc?.length) body.bcc = mail.bcc;
    if (mail.attachments?.length) {
      body.attachments = mail.attachments.map((a) => ({
        filename: a.filename,
        fileblob: a.content,
        mimetype: a.contentType ?? 'application/octet-stream',
      }));
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: { email_id?: string; error?: string; error_code?: string };
    };
    const err = json.data?.error;
    if (!res.ok || err) {
      return {
        success: false,
        provider: 'smtp',
        error: err ? `${json.data?.error_code ?? ''} ${err}` : `HTTP ${res.status}`,
      };
    }
    return { success: true, provider: 'smtp', id: json.data?.email_id };
  },
};
