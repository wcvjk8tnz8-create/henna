import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qAll, exec } from '../db/query';

const rule = new Hono<{ Bindings: Env; Variables: AppEnv['Variables'] }>();

interface RuleRow {
  id: number;
  user_id: number;
  name: string;
  match_address: string;
  match_from: string;
  match_subject: string;
  action: string;
  target: string;
  enabled: number;
  created_at: number;
}

export const ACTIONS = [
  { value: 'webhook', label: 'Webhook（POST JSON）' },
  { value: 'telegram', label: 'Telegram 机器人' },
  { value: 'forward', label: '转发到外部邮箱' },
] as const;

rule.get('/actions', authRequired, (c) => c.json(ok(ACTIONS)));

rule.get('/', authRequired, async (c) => {
  const user = c.get('user');
  const rows =
    user.role === 'admin'
      ? await qAll<RuleRow>(c.env.DB, 'SELECT * FROM mail_rule ORDER BY id DESC LIMIT 200')
      : await qAll<RuleRow>(c.env.DB, 'SELECT * FROM mail_rule WHERE user_id = ? ORDER BY id DESC', user.id);
  return c.json(ok(rows));
});

rule.post('/', authRequired, async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as Partial<RuleRow>;
  if (!body.name || !body.action || !body.target) throw new HttpError('名称 / 动作 / 目标必填');
  if (!ACTIONS.some((a) => a.value === body.action)) throw new HttpError('未知动作类型');
  await exec(
    c.env.DB,
    'INSERT INTO mail_rule (user_id, name, match_address, match_from, match_subject, action, target, enabled, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    user.id,
    body.name,
    body.match_address ?? '',
    body.match_from ?? '',
    body.match_subject ?? '',
    body.action,
    body.target,
    body.enabled ?? 1,
    Date.now(),
  );
  return c.json(ok({ created: true }));
});

rule.put('/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as Partial<RuleRow>;
  const where = user.role === 'admin' ? '' : ' AND user_id = ?';
  await exec(
    c.env.DB,
    `UPDATE mail_rule SET name = COALESCE(?, name), match_address = COALESCE(?, match_address), match_from = COALESCE(?, match_from), match_subject = COALESCE(?, match_subject), action = COALESCE(?, action), target = COALESCE(?, target), enabled = COALESCE(?, enabled) WHERE id = ?${where}`,
    body.name ?? null,
    body.match_address ?? null,
    body.match_from ?? null,
    body.match_subject ?? null,
    body.action ?? null,
    body.target ?? null,
    body.enabled ?? null,
    id,
    ...(user.role === 'admin' ? [] : [user.id]),
  );
  return c.json(ok({ updated: true }));
});

rule.delete('/:id', authRequired, async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  if (user.role === 'admin') await exec(c.env.DB, 'DELETE FROM mail_rule WHERE id = ?', id);
  else await exec(c.env.DB, 'DELETE FROM mail_rule WHERE id = ? AND user_id = ?', id, user.id);
  return c.json(ok({ deleted: true }));
});

export default rule;
