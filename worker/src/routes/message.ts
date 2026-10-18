import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qAll, qOne, exec } from '../db/query';
import { clamp } from '../lib/util';

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
  size: number;
  created_at: number;
}

message.get('/', authRequired, async (c) => {
  const user = c.get('user');
  const box = c.req.query('box') === 'out' ? 'out' : 'in';
  const q = (c.req.query('q') ?? '').trim();
  const limit = clamp(Number(c.req.query('limit') ?? 50), 1, 200);
  const offset = clamp(Number(c.req.query('offset') ?? 0), 0, 100000);

  let sql = 'SELECT id, user_id, address_id, direction, from_addr, from_name, to_addr, subject, is_read, is_star, size, created_at FROM mail_message WHERE direction = ?';
  const args: unknown[] = [box];
  if (user.role !== 'admin') {
    sql += ' AND user_id = ?';
    args.push(user.id);
  }
  if (q) {
    sql += ' AND (subject LIKE ? OR from_addr LIKE ? OR to_addr LIKE ?)';
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  args.push(limit, offset);

  const rows = await qAll<MessageRow>(c.env.DB, sql, ...args);
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

message.post('/:id/read', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  await exec(c.env.DB, 'UPDATE mail_message SET is_read = 1 WHERE id = ?', id);
  return c.json(ok({ updated: true }));
});

message.post('/:id/star', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  const { star } = (await c.req.json().catch(() => ({}))) as { star?: number };
  await exec(c.env.DB, 'UPDATE mail_message SET is_star = ? WHERE id = ?', star ? 1 : 0, id);
  return c.json(ok({ updated: true }));
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

export default message;
