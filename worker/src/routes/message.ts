import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qAll, qOne, exec } from '../db/query';
import { clamp } from '../lib/util';
import { getAllSettings, isTrue } from '../db/settings';

const message = new Hono<{ Bindings: Env; Variables: AppEnv['Variables'] }>();

interface MessageRow {
  id: number;
  user_id: number;
  address_id: number | null;
  direction: string;
  message_id: string | null;
  from_addr: string;
  from_name: string;
  to_addr: string;
  subject: string;
  text_body: string | null;
  html_body: string | null;
  is_read: number;
  is_star: number;
  is_spam: number;
  spam_score: number;
  spam_reason: string;
  spam_source: string;
  size: number;
  created_at: number;
}

/**
 * 列表。
 *
 * 默认**只看自己的** —— 管理员也一样。要看全部走 scope=all（仅管理员）。
 * box=spam 是垃圾箱视图（收信里被判为垃圾的那些）。
 * 收件箱默认隐藏垃圾邮件，由 spam_hide_inbox 控制，避免正常列表被污染。
 */
message.get('/', authRequired, async (c) => {
  const user = c.get('user');
  const boxRaw = c.req.query('box') ?? 'in';
  const box = (['in', 'out', 'draft', 'spam'] as const).includes(boxRaw as never)
    ? (boxRaw as 'in' | 'out' | 'draft' | 'spam')
    : 'in';
  const q = (c.req.query('q') ?? '').trim();
  const limit = clamp(Number(c.req.query('limit') ?? 50), 1, 200);
  const offset = clamp(Number(c.req.query('offset') ?? 0), 0, 100000);

  // scope=all 仅管理员可用；普通用户传了也无效（按自己的返回）
  const all = c.req.query('scope') === 'all' && user.role === 'admin';
  const p = all ? 'm.' : '';
  const direction = box === 'spam' ? 'in' : box;

  let sql = all
    ? `SELECT m.id, m.user_id, m.address_id, m.direction, m.from_addr, m.from_name, m.to_addr, m.subject, m.is_read, m.is_star, m.is_spam, m.spam_score, m.spam_reason, m.spam_source, m.size, m.created_at, u.email AS owner FROM mail_message m LEFT JOIN user u ON u.id = m.user_id WHERE m.direction = ?`
    : `SELECT id, user_id, address_id, direction, from_addr, from_name, to_addr, subject, is_read, is_star, is_spam, spam_score, spam_reason, spam_source, size, created_at FROM mail_message WHERE direction = ? AND user_id = ?`;
  const args: unknown[] = [direction];
  if (!all) args.push(user.id);

  if (box === 'spam') {
    sql += ` AND ${p}is_spam = 1`;
  } else if (box === 'in' && c.req.query('include_spam') !== '1') {
    const st = await getAllSettings(c.env.DB);
    if (isTrue(st.spam_hide_inbox)) sql += ` AND ${p}is_spam = 0`;
  }

  if (c.req.query('star') === '1') sql += ` AND ${p}is_star = 1`;
  if (q) {
    sql += ` AND (${p}subject LIKE ? OR ${p}from_addr LIKE ? OR ${p}to_addr LIKE ?)`;
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY ${p}created_at DESC LIMIT ? OFFSET ?`;
  args.push(limit, offset);

  const rows = await qAll<MessageRow & { owner?: string }>(c.env.DB, sql, ...args);
  return c.json(ok(rows));
});

message.get('/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await qOne<MessageRow>(c.env.DB, 'SELECT * FROM mail_message WHERE id = ?', id);
  if (!row) throw new HttpError('邮件不存在', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) throw new HttpError('无权访问', 403);
  const atts = await qAll(
    c.env.DB,
    'SELECT id, name, mime, size FROM mail_attachment WHERE message_id = ?',
    id,
  );
  if (row.direction === 'in' && row.is_read === 0) {
    await exec(c.env.DB, 'UPDATE mail_message SET is_read = 1 WHERE id = ?', id);
  }
  return c.json(ok({ ...row, attachments: atts }));
});

type MsgCtx = {
  get: (k: 'user') => { id: number; role: string };
  env: Env;
  req: { json: () => Promise<unknown> };
};

/** 取邮件并校验归属：不是自己的且不是管理员 → 403 */
async function assertOwn(c: MsgCtx, id: number): Promise<MessageRow> {
  const user = c.get('user');
  const row = await qOne<MessageRow>(c.env.DB, 'SELECT * FROM mail_message WHERE id = ?', id);
  if (!row) throw new HttpError('邮件不存在', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) throw new HttpError('无权操作', 403);
  return row;
}

message.post('/:id/read', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  await assertOwn(c, id);
  await exec(c.env.DB, 'UPDATE mail_message SET is_read = 1 WHERE id = ?', id);
  return c.json(ok({ updated: true }));
});

message.post('/:id/star', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  await assertOwn(c, id);
  const { star } = (await c.req.json().catch(() => ({}))) as { star?: number };
  await exec(c.env.DB, 'UPDATE mail_message SET is_star = ? WHERE id = ?', star ? 1 : 0, id);
  return c.json(ok({ updated: true }));
});

/**
 * 手动标记垃圾 / 纠正误判。
 * 用户点「不是垃圾」会把 is_spam 清 0 并留痕，AI 下次仍会重新判，
 * 但这条记录本身不会被再次自动改动。
 */
message.post('/:id/spam', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  await assertOwn(c, id);
  const { spam } = (await c.req.json().catch(() => ({}))) as { spam?: number | boolean };
  const yes = spam === 1 || spam === true;
  await exec(
    c.env.DB,
    'UPDATE mail_message SET is_spam = ?, spam_reason = ?, spam_source = ? WHERE id = ?',
    yes ? 1 : 0,
    yes ? '手动标记为垃圾' : '手动纠正为正常',
    'user',
    id,
  );
  return c.json(ok({ updated: true, is_spam: yes ? 1 : 0 }));
});

message.delete('/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await qOne<MessageRow>(c.env.DB, 'SELECT * FROM mail_message WHERE id = ?', id);
  if (!row) throw new HttpError('邮件不存在', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) throw new HttpError('无权操作', 403);
  const atts = await qAll<{ r2_key: string }>(c.env.DB, 'SELECT r2_key FROM mail_attachment WHERE message_id = ?', id);
  if (c.env.R2) {
    for (const a of atts) await c.env.R2.delete(a.r2_key).catch(() => undefined);
  }
  await exec(c.env.DB, 'DELETE FROM mail_attachment WHERE message_id = ?', id);
  await exec(c.env.DB, 'DELETE FROM mail_message WHERE id = ?', id);
  return c.json(ok({ deleted: true }));
});

/** 附件下载：从 R2 流式返回 */
message.get('/attachment/:id', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  const att = await qOne<{ id: number; message_id: number; name: string; mime: string; r2_key: string }>(
    c.env.DB,
    'SELECT * FROM mail_attachment WHERE id = ?',
    id,
  );
  if (!att) throw new HttpError('附件不存在', 404);
  if (!c.env.R2) throw new HttpError('未启用附件存储（R2），仅保留附件信息', 404);
  const obj = await c.env.R2.get(att.r2_key);
  if (!obj) throw new HttpError('附件已过期', 404);
  const headers = new Headers();
  headers.set('Content-Type', att.mime);
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.name)}`);
  return new Response(obj.body, { headers });
});

/** 保存 / 更新草稿。带 id 则更新，否则新建。 */
message.post('/draft', authRequired, async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: number;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
    from?: string;
  };
  if (!body.id && !body.to && !body.subject && !body.text && !body.html) {
    throw new HttpError('草稿内容为空');
  }
  const now = Date.now();

  if (body.id) {
    const old = await qOne<MessageRow>(
      c.env.DB,
      'SELECT * FROM mail_message WHERE id = ? AND direction = ?',
      body.id,
      'draft',
    );
    if (!old) throw new HttpError('草稿不存在', 404);
    if (user.role !== 'admin' && old.user_id !== user.id) throw new HttpError('无权操作', 403);
    await exec(
      c.env.DB,
      'UPDATE mail_message SET to_addr = ?, from_addr = ?, subject = ?, text_body = ?, html_body = ?, created_at = ? WHERE id = ?',
      body.to ?? old.to_addr,
      body.from ?? old.from_addr,
      body.subject ?? old.subject,
      body.text ?? old.text_body,
      body.html ?? old.html_body,
      now,
      body.id,
    );
    return c.json(ok({ id: body.id, updated: true }));
  }

  const inserted = await c.env.DB.prepare(
    'INSERT INTO mail_message (user_id, address_id, direction, from_addr, to_addr, subject, text_body, html_body, is_read, is_star, size, created_at) VALUES (?,NULL,?,?,?,?,?,?,1,0,?,?) RETURNING id',
  )
    .bind(
      user.id,
      'draft',
      body.from ?? '',
      body.to ?? '',
      body.subject ?? '(无主题)',
      body.text ?? null,
      body.html ?? null,
      (body.text ?? '').length + (body.html ?? '').length,
      now,
    )
    .first<{ id: number }>();
  return c.json(ok({ id: inserted?.id ?? 0, created: true }));
});

/** 删除草稿 */
message.delete('/draft/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const row = await qOne<MessageRow>(
    c.env.DB,
    'SELECT * FROM mail_message WHERE id = ? AND direction = ?',
    id,
    'draft',
  );
  if (!row) throw new HttpError('草稿不存在', 404);
  if (user.role !== 'admin' && row.user_id !== user.id) throw new HttpError('无权操作', 403);
  await exec(c.env.DB, 'DELETE FROM mail_message WHERE id = ?', id);
  return c.json(ok({ deleted: true }));
});

export default message;
