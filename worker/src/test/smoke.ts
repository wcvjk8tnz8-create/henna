/**
 * 冒烟测试：验证密码哈希、JWT、服务商调度与故障转移。
 * 运行：node scripts/smoke.mjs（需先 npm run build:test）
 */
import { hashPassword, verifyPassword, randomHex } from '../lib/crypto';
import { signJwt, verifyJwt } from '../lib/jwt';
import { dispatchMail, PROVIDERS } from '../providers';
import type { ProviderRow } from '../providers';
import type { Env } from '../env';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra ?? '');
  }
}

const SECRET = 'test-secret-0123456789abcdef';

// ── 1. 口令哈希
const salt = randomHex(16);
const hash = await hashPassword('henna-mail', salt);
check('hashPassword 产出 64 位 hex', hash.length === 64, hash.length);
check('verifyPassword 正确口令', await verifyPassword('henna-mail', salt, hash));
check('verifyPassword 拒绝错误口令', !(await verifyPassword('wrong', salt, hash)));

// ── 2. JWT
const token = await signJwt({ sub: 1, email: 'a@b.c', role: 'admin' }, SECRET);
const payload = await verifyJwt(token, SECRET);
check('signJwt/verifyJwt 往返', payload?.email === 'a@b.c' && payload?.role === 'admin', payload);
check('verifyJwt 拒绝错误密钥', (await verifyJwt(token, 'other-secret')) === null);
const expired = await signJwt({ sub: 1, email: 'a@b.c', role: 'user' }, SECRET, -10);
check('verifyJwt 拒绝过期令牌', (await verifyJwt(expired, SECRET)) === null);

// ── 3. Mock Env
const calls: string[] = [];
function makeEnv(handler: (url: string, init: RequestInit) => Response): Env {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({ run: async () => ({ success: true }), all: async () => ({ results: [] }), first: async () => null }),
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
        first: async () => null,
      }),
    } as unknown as D1Database,
    KV: {} as KVNamespace,
    R2: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    APP_NAME: 'Henna Mail',
    JWT_SECRET: SECRET,
    ADMIN_EMAIL: 'admin@x.com',
    MAIL_DOMAINS: '["henna.dev"]',
    ALLOW_REGISTER: 'true',
    DEFAULT_QUOTA: '50',
    PROVIDER_STRATEGY: 'priority',
  } as Env;
}

globalThis.fetch = (async (url: string, init: RequestInit) => {
  calls.push(String(url));
  if (String(url).includes('api.resend.com')) return Response.json({ id: 're_123' }, { status: 200 });
  if (String(url).includes('api.sendgrid.com')) return new Response('', { status: 202, headers: { 'x-message-id': 'sg_1' } });
  return Response.json({ message: 'boom' }, { status: 500 });
}) as typeof fetch;

// ── 4. 优先级 + 故障转移
const rows: ProviderRow[] = [
  { id: 1, name: '坏通道', kind: 'resend', config: JSON.stringify({ apiKey: 'bad' }), enabled: 1, weight: 100, daily_used: 0, last_error: null },
  { id: 2, name: '好通道', kind: 'sendgrid', config: JSON.stringify({ apiKey: 'ok' }), enabled: 1, weight: 50, daily_used: 0, last_error: null },
];

// 让第一个失败：临时把 resend 指向 500
const originalResend = PROVIDERS.resend;
PROVIDERS.resend = {
  ...originalResend,
  async send() {
    return { success: false, provider: 'resend', error: 'simulated 500' };
  },
};

const env = makeEnv(() => new Response('{}', { status: 200 }));
const out = await dispatchMail(
  { from: 'ops@henna.dev', to: ['a@b.com'], subject: 'hi', html: '<b>hi</b>' },
  rows,
  env,
  { strategy: 'priority' },
);
check('故障转移到备用通道', out.result.success && out.providerId === 2, out);
check('attempts 记录两次尝试', out.attempts.length === 2, out.attempts);
check('第一次尝试被标记为失败', out.attempts[0].success === false, out.attempts[0]);

// ── 5. 全部失败
PROVIDERS.sendgrid = { ...PROVIDERS.sendgrid, async send() { return { success: false, provider: 'sendgrid', error: 'down' }; } };
const out2 = await dispatchMail(
  { from: 'ops@henna.dev', to: ['a@b.com'], subject: 'hi', text: 'hi' },
  rows,
  env,
  { strategy: 'priority' },
);
check('全部失败时返回失败并带错误', !out2.result.success && !!out2.result.error, out2.result);

// ── 6. pinned 指定通道
PROVIDERS.sendgrid = { ...PROVIDERS.sendgrid, async send() { return { success: true, provider: 'sendgrid', id: 'sg' }; } };
const out3 = await dispatchMail(
  { from: 'ops@henna.dev', to: ['a@b.com'], subject: 'hi', text: 'hi' },
  rows,
  env,
  { strategy: 'priority', providerId: 2 },
);
check('pinned 命中指定通道', out3.providerId === 2 && out3.result.success, out3);

// ── 7. 无可用通道
const out4 = await dispatchMail({ from: 'a@b.com', to: ['c@d.com'], subject: 'x', text: 'x' }, [], env);
check(
  '无通道时明确报错',
  out4.result.success === false && (out4.result.error ?? '').includes('没有已启用'),
  out4.result,
);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process?.exit?.(1);
}
