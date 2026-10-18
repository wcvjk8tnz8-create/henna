import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, adminOnly, type AppEnv } from '../middleware/auth';
import { qAll, qOne, exec } from '../db/query';
import { randomToken } from '../lib/crypto';
import { clamp } from '../lib/util';
import { resolveRole } from '../lib/admin-guard';

const admin = new Hono<{ Bindings: Env; Variables: AppEnv['Variables'] }>();

admin.use('*', authRequired, adminOnly);

admin.get('/users', async (c) => {
  const rows = await qAll(
    c.env.DB,
    'SELECT id, email, role, quota, used, status, api_key, created_at FROM user ORDER BY id DESC LIMIT 500',
  );
  return c.json(ok(rows));
});

admin.put('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    role?: string;
    quota?: number;
    status?: string;
  };
  const target = await qOne<{ id: number; email: string; role: string }>(
    c.env.DB,
    'SELECT id, email, role FROM user WHERE id = ?',
    id,
  );
  if (!target) throw new HttpError('用户不存在', 404);
  // admin@ 前缀的账号不可降级，否则管理员会把自己锁在后台外面
  const role = resolveRole(target.email, body.role);
  const downgradeBlocked = body.role === 'user' && role === 'admin';
  await exec(
    c.env.DB,
    'UPDATE user SET role = COALESCE(?, role), quota = COALESCE(?, quota), status = COALESCE(?, status) WHERE id = ?',
    role,
    body.quota ?? null,
    body.status ?? null,
    id,
  );
  return c.json(ok({ updated: true, role, downgradeBlocked }));
});

admin.delete('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await exec(c.env.DB, 'DELETE FROM mail_address WHERE user_id = ?', id);
  await exec(c.env.DB, 'DELETE FROM user WHERE id = ?', id);
  return c.json(ok({ deleted: true }));
});

/** 账号分发：批量生成邀请码 */
admin.post('/invite', async (c) => {
  const { count, quota, role, maxUse, days } = (await c.req.json().catch(() => ({}))) as {
    count?: number;
    quota?: number;
    role?: string;
    maxUse?: number;
    days?: number;
  };
  const n = clamp(Number(count ?? 1), 1, 200);
  const expire = days ? Date.now() + Number(days) * 86400000 : null;
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const code = randomToken(6);
    await exec(
      c.env.DB,
      'INSERT INTO invite_code (code, role, quota, max_use, used, expire_at, created_at) VALUES (?,?,?,?,0,?,?)',
      code,
      role ?? 'user',
      Number(quota ?? 50),
      Number(maxUse ?? 1),
      expire,
      Date.now(),
    );
    codes.push(code);
  }
  return c.json(ok({ codes }));
});

/**
 * 清空全部邀请码。
 * 用 POST + 独立路径，避免和下面的 DELETE /invite/:id 抢路由
 * （Hono 里 /invite/clear 也会被 /invite/:id 匹配到）。
 */
admin.post('/invite/clear', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM invite_code').run();
  return c.json(ok({ deleted: r.meta?.changes ?? 0 }));
});

admin.get('/invite', async (c) => {
  const rows = await qAll(c.env.DB, 'SELECT * FROM invite_code ORDER BY id DESC LIMIT 200');
  return c.json(ok(rows));
});

admin.delete('/invite/:id', async (c) => {
  await exec(c.env.DB, 'DELETE FROM invite_code WHERE id = ?', Number(c.req.param('id')));
  return c.json(ok({ deleted: true }));
});

admin.get('/stats', async (c) => {
  const [users, messages, outbox, providers, addresses, logs] = await Promise.all([
    qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM user'),
    qOne<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM mail_message WHERE direction = 'in'"),
    qOne<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM mail_message WHERE direction = 'out'"),
    qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM mail_provider WHERE enabled = 1'),
    qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM mail_address'),
    qOne<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM mail_log WHERE status = 'failed'"),
  ]);
  const recent = await qAll<{ d: string; n: number }>(
    c.env.DB,
    "SELECT date(created_at / 1000, 'unixepoch') AS d, COUNT(*) AS n FROM mail_message WHERE created_at > ? GROUP BY d ORDER BY d DESC LIMIT 14",
    Date.now() - 14 * 86400000,
  );
  const byProvider = await qAll<{ provider: string; n: number }>(
    c.env.DB,
    'SELECT provider, COUNT(*) AS n FROM mail_log GROUP BY provider ORDER BY n DESC',
  );
  // 发信成功率
  const [totalLogs, okLogs] = await Promise.all([
    qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM mail_log'),
    qOne<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM mail_log WHERE status = 'success'"),
  ]);
  // 收信来源域名 Top
  const topDomains = await qAll<{ domain: string; n: number }>(
    c.env.DB,
    `SELECT lower(substr(from_addr, instr(from_addr, '@') + 1)) AS domain, COUNT(*) AS n
     FROM mail_message WHERE direction = 'in' AND from_addr LIKE '%@%'
     GROUP BY domain ORDER BY n DESC LIMIT 8`,
  );
  // 活跃地址 Top（按收信量）
  const topAddresses = await qAll<{ address: string; n: number }>(
    c.env.DB,
    `SELECT to_addr AS address, COUNT(*) AS n FROM mail_message
     WHERE direction = 'in' GROUP BY to_addr ORDER BY n DESC LIMIT 8`,
  );
  // 今日发信
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const today = await qOne<{ n: number }>(
    c.env.DB,
    'SELECT COUNT(*) AS n FROM mail_log WHERE created_at >= ?',
    todayStart.getTime(),
  );
  return c.json(
    ok({
      users: users?.n ?? 0,
      inbox: messages?.n ?? 0,
      outbox: outbox?.n ?? 0,
      providers: providers?.n ?? 0,
      addresses: addresses?.n ?? 0,
      failed: logs?.n ?? 0,
      trend: recent.reverse(),
      byProvider,
      totalLogs: totalLogs?.n ?? 0,
      okLogs: okLogs?.n ?? 0,
      today: today?.n ?? 0,
      topDomains,
      topAddresses,
    }),
  );
});

export default admin;
