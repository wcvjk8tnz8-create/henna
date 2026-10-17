import type { Env } from '../env';
import type {
  MailProvider,
  OutgoingMail,
  ProviderConfig,
  ProviderKind,
  SendResult,
} from './types';
import { resendProvider } from './resend';
import { sendgridProvider } from './sendgrid';
import { mailgunProvider } from './mailgun';
import { brevoProvider } from './brevo';
import { postmarkProvider } from './postmark';
import { smtpProvider } from './smtp';
import { cloudflareProvider } from './cloudflare';
import { noopProvider } from './noop';

export * from './types';

/** 服务商注册表：新增一家 = 加一行，其余代码零改动 */
export const PROVIDERS: Record<ProviderKind, MailProvider> = {
  resend: resendProvider,
  sendgrid: sendgridProvider,
  mailgun: mailgunProvider,
  brevo: brevoProvider,
  postmark: postmarkProvider,
  smtp: smtpProvider,
  cloudflare: cloudflareProvider,
  noop: noopProvider,
};

export function getProvider(kind: ProviderKind): MailProvider {
  const p = PROVIDERS[kind];
  if (!p) throw new Error(`unknown provider: ${kind}`);
  return p;
}

export function listProviderMeta() {
  return Object.values(PROVIDERS).map((p) => ({
    kind: p.kind,
    label: p.label,
    docs: p.docs,
    fields: p.fields,
  }));
}

export interface ProviderRow {
  id: number;
  name: string;
  kind: ProviderKind;
  config: string;
  enabled: number;
  weight: number;
  daily_used: number;
  last_error: string | null;
}

export interface DispatchOutcome {
  result: SendResult;
  providerId: number | null;
  providerName: string;
  attempts: { provider: string; success: boolean; error?: string }[];
}

/**
 * 按策略挑一个（或依次）服务商发出邮件。
 * - pinned      : 固定指定 providerId
 * - round_robin : 按当日用量升序挑，平摊各家免费额度
 * - priority    : 按 weight 降序尝试，失败自动 failover
 */
export async function dispatchMail(
  mail: OutgoingMail,
  rows: ProviderRow[],
  env: Env,
  opts: { strategy?: string; providerId?: number } = {},
): Promise<DispatchOutcome> {
  const enabled = rows.filter((r) => r.enabled === 1);
  if (enabled.length === 0) {
    return {
      result: { success: false, provider: 'noop', error: '没有已启用的发信服务商' },
      providerId: null,
      providerName: '-',
      attempts: [],
    };
  }

  let ordered: ProviderRow[];
  if (opts.providerId) {
    const pinned = enabled.find((r) => r.id === opts.providerId);
    ordered = pinned ? [pinned, ...enabled.filter((r) => r.id !== pinned.id)] : enabled;
  } else if (opts.strategy === 'round_robin') {
    ordered = [...enabled].sort((a, b) => a.daily_used - b.daily_used || b.weight - a.weight);
  } else {
    ordered = [...enabled].sort((a, b) => b.weight - a.weight);
  }

  const attempts: DispatchOutcome['attempts'] = [];
  for (const row of ordered) {
    const impl = PROVIDERS[row.kind];
    if (!impl) {
      attempts.push({ provider: row.kind, success: false, error: '未注册的服务商' });
      continue;
    }
    let cfg: ProviderConfig = {};
    try {
      cfg = JSON.parse(row.config || '{}') as ProviderConfig;
    } catch {
      attempts.push({ provider: row.name, success: false, error: '配置 JSON 解析失败' });
      continue;
    }
    try {
      const res = await impl.send(mail, cfg, env);
      attempts.push({ provider: row.name, success: res.success, error: res.error });
      if (res.success) {
        await env.DB.prepare('UPDATE mail_provider SET daily_used = daily_used + 1, last_error = NULL, updated_at = ? WHERE id = ?')
          .bind(Date.now(), row.id)
          .run();
        return { result: res, providerId: row.id, providerName: row.name, attempts };
      }
      await env.DB.prepare('UPDATE mail_provider SET last_error = ?, updated_at = ? WHERE id = ?')
        .bind(res.error ?? 'failed', Date.now(), row.id)
        .run();
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      attempts.push({ provider: row.name, success: false, error });
      await env.DB.prepare('UPDATE mail_provider SET last_error = ?, updated_at = ? WHERE id = ?')
        .bind(error, Date.now(), row.id)
        .run();
    }
  }

  const last = attempts[attempts.length - 1];
  return {
    result: {
      success: false,
      provider: 'noop',
      error: `全部服务商失败：${last?.error ?? 'unknown'}`,
    },
    providerId: null,
    providerName: '-',
    attempts,
  };
}
