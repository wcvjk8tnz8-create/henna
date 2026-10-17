import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { ensureSchema } from '../db/schema';
import { qOne, exec, qAll } from '../db/query';
import { parseDomains } from '../lib/util';

const system = new Hono<{ Bindings: Env }>();

system.get('/health', (c) => c.json(ok({ status: 'ok', ts: Date.now() })));

/** 前端公开配置 */
system.get('/config', async (c) => {
  return c.json(
    ok({
      appName: c.env.APP_NAME || 'Henna Mail',
      domains: parseDomains(c.env),
      allowRegister: c.env.ALLOW_REGISTER === 'true',
      strategy: c.env.PROVIDER_STRATEGY || 'priority',
    }),
  );
});

/** 幂等初始化：建表 + 播种默认服务商。脚本与 Actions 部署后自动调用。 */
system.get('/init/:secret', async (c) => {
  if (c.req.param('secret') !== c.env.JWT_SECRET) throw new HttpError('密钥不匹配', 401);
  await ensureSchema(c.env.DB);

  const n = await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM mail_provider');
  if (!n || n.n === 0) {
    const now = Date.now();
    await exec(
      c.env.DB,
      'INSERT INTO mail_provider (name, kind, config, enabled, weight, daily_used, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)',
      'Noop 自测通道',
      'noop',
      '{}',
      1,
      1,
      now,
      now,
    );
  }

  const adminExists = await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM user');
  return c.json(
    ok({
      success: true,
      providers: await qAll(c.env.DB, 'SELECT id, name, kind FROM mail_provider'),
      hasAdmin: (adminExists?.n ?? 0) > 0,
      hint: '表结构已就绪。注册的第一个账号将自动成为管理员。',
    }),
  );
});

export default system;
