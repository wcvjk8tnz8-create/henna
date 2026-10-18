/**
 * OAuth2 第三方登录路由。
 *
 * GET /api/oauth/:provider/authorize  → { url, state }
 * GET /api/oauth/:provider/callback   → 302 回前端并带上 token
 * GET /api/oauth/providers            → 已启用的 provider 列表（登录页用）
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { getAllSettings, isTrue, getSetting } from '../db/settings';
import { hashPassword, randomHex, randomToken } from '../lib/crypto';
import { signJwt } from '../lib/jwt';
import { qOne, exec } from '../db/query';
import { parseDomains } from '../lib/util';
import {
  PROVIDERS,
  buildAuthorizeUrl,
  exchangeCode,
  fetchProfile,
  type OAuthProvider,
} from '../lib/oauth';

const oauth = new Hono<{ Bindings: Env }>();

const STATE_TTL = 300; // 5 分钟

interface ProviderCfg {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

async function providerCfg(db: D1Database, key: string): Promise<ProviderCfg> {
  const s = await getAllSettings(db);
  return {
    enabled: isTrue(s[`oauth_${key}_enabled`]),
    clientId: s[`oauth_${key}_client_id`] ?? '',
    clientSecret: s[`oauth_${key}_secret`] ?? '',
  };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** 已启用的第三方登录（公开） */
oauth.get('/providers', async (c) => {
  const s = await getAllSettings(c.env.DB);
  const list = ['github', 'google', 'linuxdo']
    .filter((k) => isTrue(s[`oauth_${k}_enabled`]) && s[`oauth_${k}_client_id`])
    .map((k) => ({ key: k, name: PROVIDERS[k].name }));
  return c.json(ok(list));
});

/** 生成授权地址 */
oauth.get('/:provider/authorize', async (c) => {
  const key = c.req.param('provider');
  const p: OAuthProvider | undefined = PROVIDERS[key];
  if (!p) throw new HttpError('不支持的登录方式', 400);
  const cfg = await providerCfg(c.env.DB, key);
  if (!cfg.enabled || !cfg.clientId) throw new HttpError(`${p.name} 登录未启用`, 400);

  const origin = originOf(c.req.url);
  const redirectUri = `${origin}/api/oauth/${key}/callback`;
  const state = randomHex(16);

  if (c.env.KV) {
    await c.env.KV.put(`oauth:state:${state}`, key, { expirationTtl: STATE_TTL });
  }

  return c.json(
    ok({
      url: buildAuthorizeUrl(p, { clientId: cfg.clientId, redirectUri, state }),
      state,
    }),
  );
});

/** 回调：换 token → 拉资料 → 落地用户 → 回前端 */
oauth.get('/:provider/callback', async (c) => {
  const key = c.req.param('provider');
  const p: OAuthProvider | undefined = PROVIDERS[key];
  if (!p) throw new HttpError('不支持的登录方式', 400);

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code) throw new HttpError('缺少 code 参数');

  if (c.env.KV && state) {
    const saved = await c.env.KV.get(`oauth:state:${state}`);
    if (saved !== key) throw new HttpError('state 校验失败，请重新发起登录', 400);
    await c.env.KV.delete(`oauth:state:${state}`);
  }

  const cfg = await providerCfg(c.env.DB, key);
  if (!cfg.enabled || !cfg.clientId || !cfg.clientSecret) {
    throw new HttpError(`${p.name} 登录未正确配置（缺 client id/secret）`, 400);
  }

  const origin = originOf(c.req.url);
  const redirectUri = `${origin}/api/oauth/${key}/callback`;

  const accessToken = await exchangeCode(p, {
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    code,
    redirectUri,
  });
  const profile = await fetchProfile(p, accessToken);
  if (!profile.email) throw new HttpError('未能获取到邮箱，无法完成登录', 400);

  // ── 落地：已有用户直接登录，没有就创建
  let row = await qOne<{
    id: number;
    email: string;
    role: string;
    quota: number;
    used: number;
    api_key: string | null;
    status: string;
  }>(c.env.DB, 'SELECT * FROM user WHERE email = ?', profile.email);

  const frontOrigin = origin; // 前后端同源（Worker 同时托管静态资源）

  if (!row) {
    const s = await getAllSettings(c.env.DB);
    if (!isTrue(s.allow_register)) throw new HttpError('站点已关闭注册', 403);

    const total = await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM user');
    const role = total && total.n === 0 ? 'admin' : 'user';
    const quota = Number(c.env.DEFAULT_QUOTA || 50);
    const salt = randomHex(16);
    // 第三方登录没有密码，随机生成一个不可用的占位
    const hash = await hashPassword(randomToken(24), salt);
    const apiKey = randomToken(18);
    const now = Date.now();
    await exec(
      c.env.DB,
      'INSERT INTO user (email, password_hash, salt, role, quota, used, api_key, status, created_at) VALUES (?,?,?,?,?,0,?,?,?)',
      profile.email,
      hash,
      salt,
      role,
      quota,
      apiKey,
      'active',
      now,
    );
    row = await qOne<{ id: number; email: string; role: string; quota: number; used: number; api_key: string | null; status: string }>(
      c.env.DB,
      'SELECT * FROM user WHERE email = ?',
      profile.email,
    );

    // 自动分配收信地址
    const domains = parseDomains(c.env);
    if (row && domains.length) {
      const local = profile.name
        ? String(profile.name).toLowerCase().replace(/[^a-z0-9._-]/g, '')
        : profile.email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
      const address = `${local || 'u' + row.id}@${domains[0]}`;
      await exec(
        c.env.DB,
        'INSERT OR IGNORE INTO mail_address (user_id, address, domain, enabled, created_at) VALUES (?,?,?,1,?)',
        row.id,
        address,
        domains[0],
        now,
      );
    }
  }

  if (!row) throw new HttpError('登录失败，无法创建本地用户', 500);
  if (row.status !== 'active') throw new HttpError('账号已停用', 403);

  const token = await signJwt(
    { sub: row.id, email: row.email, role: row.role as 'admin' | 'user' },
    c.env.JWT_SECRET,
  );

  // 回前端：把 token 放在 hash 里，前端再自行存起来
  return c.redirect(`${frontOrigin}/#/oauth?token=${encodeURIComponent(token)}`, 302);
});

export default oauth;
