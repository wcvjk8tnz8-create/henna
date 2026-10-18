import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qAll, qOne, exec } from '../db/query';
import { dispatchMail, type ProviderRow } from '../providers';
import type { Attachment, OutgoingMail } from '../providers/types';
import { htmlToText, clamp } from '../lib/util';

const send = new Hono<{ Bindings: Env; Variables: AppEnv['Variables'] }>();

interface SendBody {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  attachments?: Attachment[];
  providerId?: number;
}

/** 校验发件地址归属 + 配额 */
async function guard(env: Env, userId: number, role: string, from: string, count: number) {
  const addr = /<([^>]+)>|([^\s<>]+@[^\s<>]+)/.exec(from ?? '')?.[1] ?? (from ?? '');
  if (!addr.includes('@')) throw new HttpError('发件地址不合法');

  /*
   * 发件地址必须**属于本人**，管理员也不例外。
   * 之前 admin 走的是另一条分支：只要域名在托管列表里就能发，
   * 于是可以用任何人的地址发信。现在统一按归属校验。
   */
  const owned = await qOne<{ id: number }>(
    env.DB,
    'SELECT id FROM mail_address WHERE address = ? AND user_id = ?',
    addr,
    userId,
  );
  if (!owned) throw new HttpError(`无权使用发件地址 ${addr}：只能从自己的邮箱地址发信`);

  const u = await qOne<{ quota: number; used: number }>(env.DB, 'SELECT quota, used FROM user WHERE id = ?', userId);
  if (!u) throw new HttpError('用户不存在', 401);
  if (u.quota >= 0 && u.used + count > u.quota) {
    throw new HttpError(`发信配额不足（剩余 ${Math.max(0, u.quota - u.used)} 封）`, 429);
  }
}

async function loadProviders(env: Env): Promise<ProviderRow[]> {
  return qAll<ProviderRow>(env.DB, 'SELECT * FROM mail_provider WHERE enabled = 1');
}

async function recordLog(
  env: Env,
  userId: number,
  mail: OutgoingMail,
  providerId: number | null,
  providerName: string,
  status: 'success' | 'failed',
  error?: string,
) {
  await exec(
    env.DB,
    'INSERT INTO mail_log (user_id, provider_id, provider, from_addr, to_addr, subject, status, error, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    userId,
    providerId,
    providerName,
    mail.from,
    mail.to.join(','),
    mail.subject,
    status,
    error ?? null,
    Date.now(),
  );
}

async function recordOutbound(env: Env, userId: number, mail: OutgoingMail) {
  const addr = /<([^>]+)>|([^\s<>]+@[^\s<>]+)/.exec(mail.from)?.[1] ?? mail.from;
  const addrRow = await qOne<{ id: number }>(env.DB, 'SELECT id FROM mail_address WHERE address = ?', addr);
  await exec(
    env.DB,
    'INSERT INTO mail_message (user_id, address_id, direction, from_addr, to_addr, subject, text_body, html_body, is_read, is_star, size, created_at) VALUES (?,?,?,?,?,?,?,?,1,0,?,?)',
    userId,
    addrRow?.id ?? null,
    'out',
    mail.from,
    mail.to.join(','),
    mail.subject,
    mail.text ?? (mail.html ? htmlToText(mail.html) : ''),
    mail.html ?? null,
    (mail.html?.length ?? 0) + (mail.text?.length ?? 0),
    Date.now(),
  );
}

/** 单发 / 群发（多收件人一次投递） */
send.post('/', authRequired, async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as SendBody;
  if (!body.from) throw new HttpError('缺少 from');
  if (!Array.isArray(body.to) || body.to.length === 0) throw new HttpError('缺少收件人');
  if (!body.subject) throw new HttpError('缺少主题');
  if (!body.html && !body.text) throw new HttpError('正文不能为空');

  await guard(c.env, user.id, user.role, body.from, body.to.length);

  const mail: OutgoingMail = {
    from: body.from,
    to: body.to,
    cc: body.cc,
    bcc: body.bcc,
    subject: body.subject,
    html: body.html,
    text: body.text,
    attachments: body.attachments,
  };
  const rows = await loadProviders(c.env);
  const out = await dispatchMail(mail, rows, c.env, {
    strategy: c.env.PROVIDER_STRATEGY,
    providerId: body.providerId,
  });

  await recordLog(c.env, user.id, mail, out.providerId, out.providerName, out.result.success ? 'success' : 'failed', out.result.error);
  await exec(c.env.DB, 'UPDATE user SET used = used + ? WHERE id = ?', body.to.length, user.id);
  if (out.result.success) await recordOutbound(c.env, user.id, mail);

  return c.json(
    ok({
      success: out.result.success,
      messageId: out.result.id ?? null,
      provider: out.providerName,
      attempts: out.attempts,
      error: out.result.error ?? null,
    }),
    out.result.success ? 200 : 502,
  );
});

/** 批量分发：逐个收件人单独投递（互不可见），返回成功/失败明细 */
send.post('/bulk', authRequired, async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as SendBody & { batch?: number };
  if (!Array.isArray(body.to) || body.to.length === 0) throw new HttpError('缺少收件人');
  const recipients = body.to.slice(0, clamp(body.batch ?? 50, 1, 200));
  await guard(c.env, user.id, user.role, body.from, recipients.length);

  const rows = await loadProviders(c.env);
  const results: { to: string; success: boolean; provider?: string; error?: string }[] = [];
  let successCount = 0;

  for (const to of recipients) {
    const mail: OutgoingMail = {
      from: body.from,
      to: [to],
      subject: body.subject,
      html: body.html,
      text: body.text,
      attachments: body.attachments,
    };
    const out = await dispatchMail(mail, rows, c.env, {
      strategy: c.env.PROVIDER_STRATEGY,
      providerId: body.providerId,
    });
    await recordLog(c.env, user.id, mail, out.providerId, out.providerName, out.result.success ? 'success' : 'failed', out.result.error);
    if (out.result.success) {
      successCount++;
      await recordOutbound(c.env, user.id, mail);
    }
    results.push({
      to,
      success: out.result.success,
      provider: out.providerName,
      error: out.result.error,
    });
  }

  await exec(c.env.DB, 'UPDATE user SET used = used + ? WHERE id = ?', recipients.length, user.id);
  return c.json(ok({ total: recipients.length, success: successCount, failed: recipients.length - successCount, results }));
});

/** 发信日志 */
send.get('/logs', authRequired, async (c) => {
  const user = c.get('user');
  const limit = clamp(Number(c.req.query('limit') ?? 50), 1, 200);
  const sql =
    user.role === 'admin'
      ? 'SELECT * FROM mail_log ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM mail_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?';
  const rows =
    user.role === 'admin'
      ? await qAll(c.env.DB, sql, limit)
      : await qAll(c.env.DB, sql, user.id, limit);
  return c.json(ok(rows));
});

export default send;
