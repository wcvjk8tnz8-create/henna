import { Hono } from 'hono';
import type { Context } from 'hono';
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
      /** R2 未绑定时为 false，前端据此提示附件功能已降级 */
      attachments: !!c.env.R2,
    }),
  );
});

/**
 * 幂等初始化：建表 + 播种默认服务商。脚本与 Actions 部署后自动调用。
 * 同时挂在 /api/system/init/:secret 与短路径 /api/init/:secret
 * （后者是 cloud-mail 的惯例，部署脚本用的就是它）。
 *
 * 响应体约定：纯文本 "success"。部署脚本以此判定成败，不要改成 JSON。
 */
export const initHandler = async (c: Context<{ Bindings: Env }>) => {
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

  await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM user');

  // 部署脚本以响应体是否为 "success" 判定成败，这里返回纯文本
  return new Response('success', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

system.get('/init/:secret', initHandler);

export default system;
