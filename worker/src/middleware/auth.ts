import { createMiddleware } from 'hono/factory';
import type { Env, SessionUser } from '../env';
import { verifyJwt } from '../lib/jwt';
import { HttpError } from '../lib/http';

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};

/**
 * 鉴权：优先 JWT（Authorization: Bearer），其次 API Key（X-Api-Key）。
 * 解析出的用户信息写入 context，供后续 handler 与 RBAC 使用。
 */
export const authRequired = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  let user: SessionUser | null = null;

  if (token) {
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (payload) {
      const row = await c.env.DB.prepare(
        'SELECT id, email, role, quota, used FROM user WHERE id = ? AND status = ?',
      )
        .bind(payload.sub, 'active')
        .first<SessionUser>();
      if (row) user = row;
    }
  }

  if (!user) {
    const apiKey = c.req.header('X-Api-Key');
    if (apiKey) {
      const row = await c.env.DB.prepare(
        'SELECT id, email, role, quota, used FROM user WHERE api_key = ? AND status = ?',
      )
        .bind(apiKey, 'active')
        .first<SessionUser>();
      if (row) user = row;
    }
  }

  if (!user) throw new HttpError('未登录或凭证无效', 401);
  c.set('user', user);
  await next();
});

export const adminOnly = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') throw new HttpError('需要管理员权限', 403);
  await next();
});

/**
 * 可选鉴权：能解析出用户就写入 context，解析不出来也不报错。
 * 用于「管理员看到更多、游客看到部分」这类接口。
 */
export const authOptional = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    await next();
    return;
  }
  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (payload) {
      const row = await c.env.DB.prepare(
        'SELECT id, email, role, quota, used FROM user WHERE id = ? AND status = ?',
      )
        .bind(payload.sub, 'active')
        .first<SessionUser>();
      if (row) c.set('user', row);
    }
  } catch {
    /* 无效 token 等同游客 */
  }
  await next();
});
