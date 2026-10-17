import type { Env } from '../env';
import type { MailProvider, OutgoingMail, ProviderConfig, SendResult } from './types';
import { parseAddress } from './types';

/**
 * Cloudflare Email Service。
 * 优先使用原生 binding `env.SEND_EMAIL`（无需 API Key）；
 * 未配置 binding 时回退到 REST API（需 accountId + CF_API_TOKEN）。
 */
export const cloudflareProvider: MailProvider = {
  kind: 'cloudflare',
  label: 'Cloudflare Email Service',
  docs: 'https://developers.cloudflare.com/email/email-send/',
  fields: [
    {
      key: 'accountId',
      label: 'Account ID',
      type: 'text',
      placeholder: '留空则使用原生 binding',
      hint: 'Worker 已绑定 SEND_EMAIL 时无需填写',
    },
    { key: 'defaultFrom', label: '默认发件人', type: 'text' },
  ],
  async send(mail, cfg, env): Promise<SendResult> {
    const from = parseAddress(mail.from);

    if (env.SEND_EMAIL) {
      try {
        await env.SEND_EMAIL.send({
          to: mail.to.map((email) => ({ email })),
          from: { email: from.email, name: from.name },
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        });
        return { success: true, provider: 'cloudflare', id: 'binding' };
      } catch (e) {
        return { success: false, provider: 'cloudflare', error: String(e) };
      }
    }

    const accountId = cfg.accountId || env.CF_ACCOUNT_ID;
    const token = env.CF_API_TOKEN;
    if (!accountId || !token) {
      return {
        success: false,
        provider: 'cloudflare',
        error: '缺少 SEND_EMAIL binding 且未配置 CF_ACCOUNT_ID / CF_API_TOKEN',
      };
    }
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/email/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: mail.to.map((email) => ({ email })),
        from: { email: from.email, name: from.name },
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      errors?: { message: string }[];
    };
    if (!res.ok || json.success === false) {
      return {
        success: false,
        provider: 'cloudflare',
        error: json.errors?.[0]?.message ?? `HTTP ${res.status}`,
      };
    }
    return { success: true, provider: 'cloudflare', id: 'rest' };
  },
};
