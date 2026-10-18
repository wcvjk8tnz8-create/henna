import PostalMime from 'postal-mime';
import type { Env } from '../env';
import { qOne, qAll, exec } from '../db/query';
import { dispatchMail, type ProviderRow } from '../providers';
import { randomHex } from '../lib/crypto';
import type { OutgoingMail } from '../providers/types';
import { getAllSettings, isTrue } from '../db/settings';
import { putObject, type StorageConfig } from '../lib/storage';

interface ParsedMail {
  from?: { name?: string; address?: string };
  to?: { name?: string; address?: string }[];
  subject?: string;
  html?: string;
  text?: string;
  attachments?: { filename: string; mimeType: string; content: ArrayBuffer }[];
}

interface RuleRow {
  id: number;
  user_id: number;
  match_address: string;
  match_from: string;
  match_subject: string;
  action: string;
  target: string;
  enabled: number;
}

/** 入站邮件处理：Email Routing → Worker → D1 + R2 → 规则分发 */
export async function handleIncoming(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = (await PostalMime.parse(raw)) as ParsedMail;

  const recipients = [
    ...(parsed.to ?? []).map((t) => (t.address ?? '').toLowerCase()),
    (message.to ?? '').toLowerCase(),
  ].filter(Boolean);
  const uniqueRecipients = [...new Set(recipients)];

  let ownerId: number | null = null;
  let addressId: number | null = null;
  for (const to of uniqueRecipients) {
    const row = await qOne<{ id: number; user_id: number; enabled: number }>(
      env.DB,
      'SELECT id, user_id, enabled FROM mail_address WHERE address = ?',
      to,
    );
    if (row) {
      ownerId = row.user_id;
      addressId = row.id;
      break;
    }
  }
  // 无人认领的邮件直接丢弃（避免垃圾堆积）
  if (!ownerId) return;

  const fromAddr = parsed.from?.address ?? '';
  const fromName = parsed.from?.name ?? '';
  const subject = parsed.subject ?? '(无主题)';
  const now = Date.now();

  const inserted = await env.DB.prepare(
    'INSERT INTO mail_message (user_id, address_id, direction, message_id, from_addr, from_name, to_addr, subject, text_body, html_body, is_read, is_star, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,?) RETURNING id',
  )
    .bind(
      ownerId,
      addressId,
      'in',
      message.headers.get('message-id') ?? null,
      fromAddr,
      fromName,
      uniqueRecipients.join(','),
      subject,
      parsed.text ?? null,
      parsed.html ?? null,
      raw.byteLength,
      now,
    )
    .first<{ id: number }>();
  const messageId = inserted?.id ?? 0;

  // 附件落对象存储（R2 / S3 / 未启用时只登记元信息，绝不中断收信）
  const st = await getAllSettings(env.DB);
  const storage: StorageConfig = {
    type: (st.storage_type as 'r2' | 's3' | 'none') || 'r2',
    publicDomain: st.storage_public_domain ?? '',
    s3Endpoint: st.s3_endpoint ?? '',
    s3Region: st.s3_region ?? 'auto',
    s3Bucket: st.s3_bucket ?? '',
    s3AccessKey: st.s3_access_key ?? '',
    s3SecretKey: st.s3_secret_key ?? '',
  };
  for (const att of parsed.attachments ?? []) {
    const key = `att/${ownerId}/${messageId}/${randomHex(8)}-${att.filename ?? 'file'}`;
    try {
      await putObject(storage, env.R2, key, att.content, {
        contentType: att.mimeType || 'application/octet-stream',
      });
    } catch (e) {
      console.error('attachment store failed', e);
    }
    await exec(
      env.DB,
      'INSERT INTO mail_attachment (message_id, name, mime, size, r2_key) VALUES (?,?,?,?,?)',
      messageId,
      att.filename ?? 'file',
      att.mimeType || 'application/octet-stream',
      att.content.byteLength,
      key,
    );
  }

  const payload = {
    to: uniqueRecipients.join(','),
    from: fromAddr,
    subject,
    text: parsed.text ?? '',
    html: parsed.html ?? '',
  };
  await dispatchRules(env, ownerId, payload);
  await dispatchGlobal(env, payload);
}

async function dispatchRules(
  env: Env,
  userId: number,
  mail: { to: string; from: string; subject: string; text: string; html: string },
): Promise<void> {
  const rules = await qAll<RuleRow>(
    env.DB,
    'SELECT * FROM mail_rule WHERE user_id = ? AND enabled = 1',
    userId,
  );
  for (const r of rules) {
    if (r.match_address && !mail.to.includes(r.match_address)) continue;
    if (r.match_from && !mail.from.includes(r.match_from)) continue;
    if (r.match_subject && !mail.subject.includes(r.match_subject)) continue;
    try {
      if (r.action === 'telegram') {
        const [token, chatId] = r.target.split(/[|:]/);
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `📮 *${escapeMd(mail.subject)}*\nFrom: ${escapeMd(mail.from)}\nTo: ${escapeMd(mail.to)}\n\n${escapeMd(
              (mail.text || mail.html).slice(0, 1200),
            )}`,
            parse_mode: 'Markdown',
          }),
        });
      } else if (r.action === 'webhook') {
        await fetch(r.target, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'incoming', ...mail, userId }),
        });
      } else if (r.action === 'forward') {
        const rows = await qAll<ProviderRow>(env.DB, 'SELECT * FROM mail_provider WHERE enabled = 1');
        const out: OutgoingMail = {
          from: mail.to.split(',')[0],
          to: [r.target],
          subject: `Fwd: ${mail.subject}`,
          text: mail.text,
          html: mail.html || undefined,
        };
        await dispatchMail(out, rows, env, { strategy: env.PROVIDER_STRATEGY });
      }
    } catch (e) {
      console.error('rule dispatch failed', r.id, e);
    }
  }
}

function escapeMd(s: string): string {
  return s.replace(/([_*`\[\]])/g, '\\$1');
}


/**
 * 全局推送：管理员在系统设置里配置的兜底通知通道。
 * 用户级规则优先跑，全局通道随后执行；彼此失败互不影响。
 */
async function dispatchGlobal(
  env: Env,
  mail: { to: string; from: string; subject: string; text: string; html: string },
): Promise<void> {
  const s = await getAllSettings(env.DB);
  const body = `📮 *${escapeMd(mail.subject)}*\nFrom: ${escapeMd(mail.from)}\nTo: ${escapeMd(mail.to)}\n\n${escapeMd(
    (mail.text || mail.html).slice(0, 1200),
  )}`;

  // Telegram
  if (isTrue(s.push_telegram_enabled) && s.telegram_bot_token && s.telegram_chat_id) {
    try {
      await fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: s.telegram_chat_id,
          text: body,
          parse_mode: 'Markdown',
        }),
      });
    } catch (e) {
      console.error('global telegram failed', e);
    }
  }

  // Webhook
  if (isTrue(s.push_webhook_enabled) && s.webhook_url) {
    try {
      await fetch(s.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'incoming', source: 'global', ...mail }),
      });
    } catch (e) {
      console.error('global webhook failed', e);
    }
  }

  // 转发到外部邮箱：all = 每封都转；rule = 仅当没有命中任何用户规则时兜底转发
  if (isTrue(s.push_forward_enabled) && s.forward_email && s.forward_mode === 'all') {
    try {
      const rows = await qAll<ProviderRow>(env.DB, 'SELECT * FROM mail_provider WHERE enabled = 1');
      await dispatchMail(
        {
          from: mail.to.split(',')[0],
          to: [s.forward_email],
          subject: `Fwd: ${mail.subject}`,
          text: mail.text,
          html: mail.html || undefined,
        },
        rows,
        env,
        { strategy: env.PROVIDER_STRATEGY },
      );
    } catch (e) {
      console.error('global forward failed', e);
    }
  }
}
