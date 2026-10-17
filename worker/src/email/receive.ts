import PostalMime from 'postal-mime';
import type { Env } from '../env';
import { qOne, qAll, exec } from '../db/query';
import { dispatchMail, type ProviderRow } from '../providers';
import { randomHex } from '../lib/crypto';
import type { OutgoingMail } from '../providers/types';

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

  // 附件落 R2
  for (const att of parsed.attachments ?? []) {
    const key = `att/${ownerId}/${messageId}/${randomHex(8)}-${att.filename ?? 'file'}`;
    await env.R2.put(key, att.content, {
      httpMetadata: { contentType: att.mimeType || 'application/octet-stream' },
    });
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

  await dispatchRules(
    env,
    ownerId,
    { to: uniqueRecipients.join(','), from: fromAddr, subject, text: parsed.text ?? '', html: parsed.html ?? '' },
  );
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
