import { Hono } from 'hono';
import type { Env } from '../env';
import { hashPassword, randomHex, randomToken, verifyPassword } from '../lib/crypto';
import { signJwt } from '../lib/jwt';
import { fail, HttpError, ok } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qOne, exec } from '../db/query';
import { parseDomains } from '../lib/util';

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  salt: string;
  role: string;
  quota: number;
  used: number;
  api_key: string | null;
  status: string;
}

const auth = new Hono<{ Bindings: Env }>();

/** 注册：首个用户自动成为 admin；可选邀请码控制 */
auth.post('/register', async (c) => {
  if (c.env.ALLOW_REGISTER !== 'true') throw new HttpError('站点已关闭注册', 403);
  const { email, password, code } = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    code?: string;
  };
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError('邮箱格式不正确');
  if (!password || password.length < 6) throw new HttpError('密码至少 6 位');

  const exist = await qOne(c.env.DB, 'SELECT id FROM user WHERE email = ?', email);
  if (exist) throw new HttpError('该邮箱已注册');

  const total = await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM user');
  let role = total && total.n === 0 ? 'admin' : 'user';
  let quota = Number(c.env.DEFAULT_QUOTA || 50);

  if (code) {
    const inv = await qOne<{ id: number; role: string; quota: number; max_use: number; used: number; expire_at: number | null }>(
      c.env.DB,
      'SELECT * FROM invite_code WHERE code = ?',
      code,
    );
    if (!inv) throw new HttpError('邀请码无效');
    if (inv.used >= inv.max_use) throw new HttpError('邀请码已被用完');
    if (inv.expire_at && inv.expire_at < Date.now()) throw new HttpError('邀请码已过期');
    role = inv.role;
    quota = inv.quota;
    await exec(c.env.DB, 'UPDATE invite_code SET used = used + 1 WHERE id = ?', inv.id);
  } else if (role !== 'admin') {
    const needInvite = await qOne<{ value: string }>(
      c.env.DB,
      "SELECT value FROM setting WHERE key = 'require_invite'",
    );
    if (needInvite?.value === 'true') throw new HttpError('当前需要邀请码注册');
  }

  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const apiKey = randomToken(18);
  const now = Date.now();
  await exec(
    c.env.DB,
    'INSERT INTO user (email, password_hash, salt, role, quota, used, api_key, status, created_at) VALUES (?,?,?,?,?,0,?,?,?)',
    email,
    hash,
    salt,
    role,
    quota,
    apiKey,
    'active',
    now,
  );
  const row = await qOne<UserRow>(c.env.DB, 'SELECT * FROM user WHERE email = ?', email);
  if (!row) throw new HttpError('注册失败', 500);

  // 自动分配一个收信地址
  const domains = parseDomains(c.env);
  if (domains.length) {
    const local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
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

  const token = await signJwt({ sub: row.id, email: row.email, role: role as 'admin' | 'user' }, c.env.JWT_SECRET);
  return c.json(ok({ token, user: { id: row.id, email: row.email, role, quota, used: 0, api_key: apiKey } }));
});

auth.post('/login', async (c) => {
  const { email, password } = (await c.req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };
  if (!email || !password) throw new HttpError('请输入邮箱与密码');
  const row = await qOne<UserRow>(c.env.DB, 'SELECT * FROM user WHERE email = ?', email);
  if (!row || row.status !== 'active') throw new HttpError('用户不存在或已停用', 401);
  const okPwd = await verifyPassword(password, row.salt, row.password_hash);
  if (!okPwd) throw new HttpError('密码错误', 401);
  const token = await signJwt(
    { sub: row.id, email: row.email, role: row.role as 'admin' | 'user' },
    c.env.JWT_SECRET,
  );
  return c.json(
    ok({
      token,
      user: {
        id: row.id,
        email: row.email,
        role: row.role,
        quota: row.quota,
        used: row.used,
        api_key: row.api_key,
      },
    }),
  );
});

auth.get('/me', authRequired, async (c) => {
  const u = c.get('user') as { id: number; email: string; role: string; quota: number; used: number };
  const row = await qOne<{ api_key: string | null }>(c.env.DB, 'SELECT api_key FROM user WHERE id = ?', u.id);
  return c.json(ok({ ...u, api_key: row?.api_key ?? null }));
});

auth.post('/api-key', authRequired, async (c) => {
  const u = c.get('user') as { id: number };
  const key = randomToken(18);
  await exec(c.env.DB, 'UPDATE user SET api_key = ? WHERE id = ?', key, u.id);
  return c.json(ok({ api_key: key }));
});

export default auth;
