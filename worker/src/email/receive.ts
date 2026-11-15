import PostalMime from 'postal-mime';
import type { Env } from '../env';
import { qOne, qAll, exec } from '../db/query';
import { dispatchMail, type ProviderRow } from '../providers';
import { randomHex } from '../lib/crypto';
import type { OutgoingMail } from '../providers/types';
import { getAllSettings, isTrue } from '../db/settings';
import { putObject, type StorageConfig } from '../lib/storage';
import { classifySpam } from '../lib/spam';
import {
  extractEmail,
  stripPlusTag,
  toRecipients,
  type InboundAttachment,
  type InboundMail,
} from './types';

interface ParsedMime {
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

type DispatchMail = {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  spam?: boolean;
  spamScore?: number;
  spamReason?: string;
};

/* ──────────────────────────────────────────────────────────────
 * 统一的入站处理入口
 *
 * 两条来源共用这一套逻辑：
 *   A. Cloudflare Email Routing（域名托管在 CF）
 *   B. 发信商 inbound webhook / 自建接口（域名不在 CF）
 * 归属匹配、AI 垃圾侦测、附件存储、规则分发、全局推送全部在这里。
 * ────────────────────────────────────────────────────────────── */
export async function ingestInbound(
  env: Env,
  mail: InboundMail,
): Promise<{ status: 'ok' | 'dropped' | 'duplicate'; messageId?: number; reason?: string }> {
  const recipients = toRecipients(mail.to);
  if (!recipients.length) return { status: 'dropped', reason: '无收件人' };

  /* 去重：Postmark 最多重试 10 次、SendGrid 重试 3 天，必须幂等。
   * 优先用服务商事件 id，其次用 Message-ID。 */
  const dedupeKeys = [mail.eventId, mail.messageId].filter((v): v is string => !!v);
  for (const k of dedupeKeys) {
    const dup = await qOne<{ id: number }>(
      env.DB,
      'SELECT id FROM mail_message WHERE direction = ? AND (message_id = ? OR external_id = ?) LIMIT 1',
      'in',
      k,
      k,
    ).catch(() => null);
    if (dup) return { status: 'duplicate', messageId: dup.id, reason: `重复投递 ${k}` };
  }

  /* 归属匹配：先按原样查，查不到把 +tag 去掉再查。
   * 发信商普遍支持子地址寻址（Postmark 的 MailboxHash），
   * 不去掉的话 support+ticket-1@domain 会找不到主人。 */
  let ownerId: number | null = null;
  let addressId: number | null = null;
  for (const to of recipients) {
    // 原样 → 去 +tag，去重后逐个试
    const candidates = [...new Set([to, stripPlusTag(to)])];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const row = await qOne<{ id: number; user_id: number }>(
        env.DB,
        'SELECT id, user_id FROM mail_address WHERE address = ? AND enabled = 1',
        candidate.toLowerCase(),
      );
      if (row) {
        ownerId = row.user_id;
        addressId = row.id;
        break;
      }
    }
    if (ownerId) break;
  }
  // 无人认领的邮件直接丢弃（避免垃圾堆积）
  if (!ownerId) {
    await logInbound(env, mail, null, 'dropped', withWarning('收件地址无人认领', mail.warning));
    return { status: 'dropped', reason: '收件地址无人认领' };
  }

  const fromAddr = extractEmail(mail.from) || mail.from;
  const subject = mail.subject || '(无主题)';
  const now = Date.now();

  /* ── 垃圾邮件侦测（Workers AI）────────────────────────
   * 放在入库前：AI 不可用时 classifySpam 内部会退到启发式规则，
   * 整个过程不抛异常，收信链路绝不会被侦测拖垮。 */
  const st = await getAllSettings(env.DB);
  const mailForAi = { from: fromAddr, subject, text: mail.text ?? '', html: mail.html ?? '' };
  const verdict = await classifySpam(env, mailForAi, st);
  // 服务商自带的垃圾评分只作参考展示，不覆盖 Workers AI 的裁决
  // （避免第三方评分口径不一致造成误杀）
  if (typeof mail.spamHint === 'number' && Number.isFinite(mail.spamHint)) {
    verdict.reason = `服务商评分 ${mail.spamHint.toFixed(2)} · ${verdict.reason}`;
  }

  // reject = 直接丢弃（不入库、不分发）。默认 mark，不会误杀。
  if (isTrue(st.spam_enabled) && verdict.spam && st.spam_action === 'reject') {
    console.info('spam rejected', { from: fromAddr, subject, score: verdict.score });
    await logInbound(env, mail, ownerId, 'rejected', withWarning(`垃圾 ${verdict.score}`, mail.warning));
    return { status: 'dropped', reason: '垃圾邮件（reject）' };
  }

  const extId = mail.eventId ?? mail.messageId ?? '';
  const inserted = await env.DB.prepare(
    'INSERT INTO mail_message (user_id, address_id, direction, message_id, external_id, from_addr, from_name, to_addr, subject, text_body, html_body, is_read, is_star, is_spam, spam_score, spam_reason, spam_source, size, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,?) RETURNING id',
  )
    .bind(
      ownerId,
      addressId,
      'in',
      mail.messageId ?? null,
      extId || null,
      fromAddr,
      mail.fromName ?? '',
      recipients.join(','),
      subject,
      mail.text ?? null,
      mail.html ?? null,
      verdict.spam ? 1 : 0,
      verdict.score,
      verdict.reason,
      verdict.source,
      mail.size ?? (mail.text?.length ?? 0) + (mail.html?.length ?? 0),
      now,
    )
    .first<{ id: number }>();
  const messageId = inserted?.id ?? 0;

  // 附件落对象存储（R2 / S3 / 未启用时只登记元信息，绝不中断收信）
  const storage: StorageConfig = {
    type: (st.storage_type as 'r2' | 's3' | 'none') || 'r2',
    publicDomain: st.storage_public_domain ?? '',
    s3Endpoint: st.s3_endpoint ?? '',
    s3Region: st.s3_region ?? 'auto',
    s3Bucket: st.s3_bucket ?? '',
    s3AccessKey: st.s3_access_key ?? '',
    s3SecretKey: st.s3_secret_key ?? '',
  };
  for (const att of mail.attachments ?? []) {
    const key = `att/${ownerId}/${messageId}/${randomHex(8)}-${att.filename || 'file'}`;
    try {
      await putObject(storage, env.R2, key, att.content, {
        contentType: att.contentType || 'application/octet-stream',
      });
    } catch (e) {
      console.error('attachment store failed', e);
    }
    await exec(
      env.DB,
      'INSERT INTO mail_attachment (message_id, name, mime, size, r2_key) VALUES (?,?,?,?,?)',
      messageId,
      att.filename || 'file',
      att.contentType || 'application/octet-stream',
      att.content.byteLength,
      key,
    );
  }

  const payload: DispatchMail = {
    to: recipients.join(','),
    from: fromAddr,
    subject,
    text: mail.text ?? '',
    html: mail.html ?? '',
    spam: verdict.spam,
    spamScore: verdict.score,
    spamReason: verdict.reason,
  };

  /* 垃圾邮件默认不再往 Telegram / Webhook / 外部邮箱转发 ——
   * 否则一次垃圾轰炸会把通知通道一起打爆。 */
  const skipPush = verdict.spam && (st.spam_action === 'quarantine' || isTrue(st.spam_skip_push));
  if (!skipPush) {
    await dispatchRules(env, ownerId, payload);
    await dispatchGlobal(env, payload);
  }

  await logInbound(
    env,
    mail,
    ownerId,
    'ok',
    withWarning(verdict.spam ? `入库（垃圾 ${verdict.score}）` : '入库', mail.warning),
    messageId,
  );
  return { status: 'ok', messageId };
}

/** 入站日志：排查「为什么没收到」时全靠它 */
/** 降级提示只写日志，不进邮件正文 */
function withWarning(reason: string, warning?: string): string {
  return warning ? `${reason} · ${warning}` : reason;
}

async function logInbound(
  env: Env,
  mail: InboundMail,
  ownerId: number | null,
  status: string,
  reason: string,
  messageId?: number,
): Promise<void> {
  try {
    await exec(
      env.DB,
      'INSERT INTO inbound_log (source, event_id, from_addr, to_addr, subject, owner_id, message_id, status, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      mail.source,
      mail.eventId ?? mail.messageId ?? '',
      extractEmail(mail.from) || mail.from,
      toRecipients(mail.to).join(','),
      mail.subject || '',
      ownerId,
      messageId ?? null,
      status,
      reason,
      Date.now(),
    );
  } catch {
    /* 日志表不存在（老库还没初始化）时不影响收信 */
  }
}

/* ── A. Cloudflare Email Routing 入口 ─────────────────────── */
export async function handleIncoming(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const raw = await new Response(message.raw).arrayBuffer();
  const parsed = (await PostalMime.parse(raw)) as ParsedMime;

  const attachments: InboundAttachment[] = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename || 'file',
    contentType: a.mimeType || 'application/octet-stream',
    content: a.content,
  }));

  const mail: InboundMail = {
    from: parsed.from?.address ?? '',
    fromName: parsed.from?.name ?? '',
    to: [...toRecipients(parsed.to?.map((t) => t.address ?? '')), extractEmail(message.to)].filter(Boolean),
    subject: parsed.subject ?? '(无主题)',
    text: parsed.text ?? '',
    html: parsed.html ?? '',
    messageId: message.headers.get('message-id') ?? undefined,
    attachments,
    size: raw.byteLength,
    source: 'cloudflare',
  };
  await ingestInbound(env, mail);
}

/* ── 规则 / 全局推送（保持原逻辑） ─────────────────────────── */
async function dispatchRules(env: Env, userId: number, mail: DispatchMail): Promise<void> {
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

/** 全局推送：管理员在系统设置里配置的兜底通知通道。 */
async function dispatchGlobal(env: Env, mail: DispatchMail): Promise<void> {
  const s = await getAllSettings(env.DB);
  const body = `📮 *${escapeMd(mail.subject)}*\nFrom: ${escapeMd(mail.from)}\nTo: ${escapeMd(mail.to)}\n\n${escapeMd(
    (mail.text || mail.html).slice(0, 1200),
  )}`;

  if (isTrue(s.push_telegram_enabled) && s.telegram_bot_token && s.telegram_chat_id) {
    try {
      await fetch(`https://api.telegram.org/bot${s.telegram_bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: s.telegram_chat_id, text: body, parse_mode: 'Markdown' }),
      });
    } catch (e) {
      console.error('global telegram failed', e);
    }
  }

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
