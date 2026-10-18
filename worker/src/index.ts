import { Hono } from 'hono';
import type { Env } from './env';
import { bindErrorHandler } from './lib/http';
import { exec } from './db/query';
import { handleIncoming } from './email/receive';

import system, { initHandler } from './routes/system';
import auth from './routes/auth';
import mailbox from './routes/mailbox';
import message from './routes/message';
import send from './routes/send';
import provider from './routes/provider';
import rule from './routes/rule';
import admin from './routes/admin';
import oauth from './routes/oauth';

const app = new Hono<{ Bindings: Env }>();
bindErrorHandler(app);

app.route('/api/system', system);
app.route('/api/auth', auth);
app.route('/api/mailbox', mailbox);
app.route('/api/message', message);
app.route('/api/send', send);
app.route('/api/provider', provider);
app.route('/api/rule', rule);
app.route('/api/admin', admin);
app.route('/api/oauth', oauth);

// 初始化短路径：部署脚本用 /api/init/<JWT_SECRET>
app.get('/api/init/:secret', initHandler);

// 其余路径交给前端静态资源（wrangler assets 已配置 SPA fallback）
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  /** HTTP 入口 */
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),

  /** Cloudflare Email Routing 入口 */
  email: async (message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(handleIncoming(message, env));
  },

  /** 每日维护：重置配额与用量、清理过期日志 */
  scheduled: async (_event: ScheduledController, env: Env, _ctx: ExecutionContext) => {
    await exec(env.DB, 'UPDATE user SET used = 0');
    await exec(env.DB, 'UPDATE mail_provider SET daily_used = 0');
    await exec(env.DB, 'DELETE FROM mail_log WHERE created_at < ?', Date.now() - 90 * 86400000);
  },
} satisfies ExportedHandler<Env>;
