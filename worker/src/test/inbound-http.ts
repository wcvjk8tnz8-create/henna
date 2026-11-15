/**
 * 收信通道 HTTP 集成测试
 *
 * 用内存 D1 stub 跑完整的 Hono 路由，验证「域名不在 Cloudflare 时
 * 真的能收到信」，而不只是解析函数能跑。
 *
 * 重点：
 *  - 密钥校验
 *  - 投递 → 归属匹配 → AI 侦测 → 入库 → 日志
 *  - webhook 重试必须幂等（Postmark 重试 10 次、SendGrid 3 天）
 *  - 无人认领的邮件仍回 200（否则会引发重试风暴）
 */

export {};

import { Hono } from 'hono';
import inbound from '../routes/inbound';
import { bindErrorHandler } from '../lib/http';
import type { Env } from '../env';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

interface MsgRow { id: number; message_id: string | null; external_id: string | null; to_addr: string; subject: string }
interface LogRow { source: string; status: string; reason: string; subject: string }

function makeDb() {
  const state = { messages: [] as MsgRow[], logs: [] as LogRow[], seq: 1 };
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return this; },
        async first<T>(): Promise<T | null> {
          // 去重查询
          if (sql.includes('direction = ?') && sql.includes('message_id = ?')) {
            const k = args[1];
            const hit = state.messages.find((m) => m.message_id === k || m.external_id === k);
            return (hit ? { id: hit.id } : null) as T | null;
          }
          // 归属匹配
          if (sql.includes('FROM mail_address WHERE address')) {
            const a = String(args[0] ?? '').toLowerCase();
            return (a === 'box@r0.us.ci' ? { id: 1, user_id: 1 } : null) as T | null;
          }
          // 插入邮件
          if (sql.includes('INSERT INTO mail_message') && sql.includes('RETURNING id')) {
            const id = state.seq++;
            state.messages.push({
              id,
              message_id: (args[3] as string) ?? null,
              external_id: (args[4] as string) ?? null,
              to_addr: String(args[7] ?? ''),
              subject: String(args[8] ?? ''),
            });
            return { id } as T;
          }
          if (sql.includes('SELECT value FROM setting')) return null;
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.includes('FROM setting')) return { results: [] as T[] };
          if (sql.includes('FROM mail_rule')) return { results: [] as T[] };
          if (sql.includes('FROM mail_provider')) return { results: [] as T[] };
          if (sql.includes('FROM inbound_log')) return { results: state.logs as T[] };
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes('INSERT INTO inbound_log')) {
            state.logs.push({
              source: String(args[0] ?? ''),
              status: String(args[7] ?? ''),
              reason: String(args[8] ?? ''),
              subject: String(args[4] ?? ''),
            });
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
  return { db, state };
}

function build() {
  const { db, state } = makeDb();
  const app = new Hono<{ Bindings: Env }>();
  bindErrorHandler(app);
  app.route('/api/inbound', inbound);
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    APP_NAME: 'Henna Mail',
    ADMIN_EMAIL: 'admin@r0.us.ci',
    MAIL_DOMAINS: ['r0.us.ci'],
    ALLOW_REGISTER: 'true',
    DEFAULT_QUOTA: '50',
    PROVIDER_STRATEGY: 'priority',
    KV: {},
    ASSETS: {},
  } as unknown as Env;
  return { app, env, state };
}

function genericPost(subject: string, to = 'box@r0.us.ci', id = 'm-1', key = 'test-secret') {
  return new Request(`https://mail.test/api/inbound/generic?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'sender@example.com',
      to: [to],
      subject,
      text: 'hello',
      messageId: id,
    }),
  });
}

console.log('密钥校验：');
{
  const { app, env } = build();
  const bad = await app.request(genericPost('x', 'box@r0.us.ci', 'x1', 'wrong'), {}, env);
  check('错误密钥 → 401', bad.status === 401);
  const j = (await bad.json()) as { ok: boolean };
  check('401 响应体带错误原因', j.ok === false);
}
{
  const { app, env } = build();
  const headerOnly = new Request('https://mail.test/api/inbound/generic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Inbound-Key': 'test-secret' },
    body: JSON.stringify({ from: 'a@b.com', to: ['box@r0.us.ci'], subject: 'header key', text: 'hi', messageId: 'h1' }),
  });
  const r = await app.request(headerOnly, {}, env);
  check('支持 X-Inbound-Key 头', r.status === 200);
}

console.log('');
console.log('端到端投递：');
{
  const { app, env, state } = build();
  const r = await app.request(genericPost('第一封信', 'box@r0.us.ci', 'm-1'), {}, env);
  const j = (await r.json()) as { ok: boolean; received: number; results: { status: string }[] };
  check('返回 200', r.status === 200);
  check('received=1', j.ok === true && j.received === 1);
  check('状态 ok', j.results?.[0]?.status === 'ok');
  check('真的写入了邮件表', state.messages.length === 1);
  check('收件人正确', state.messages[0]?.to_addr === 'box@r0.us.ci');
  check('写了入站日志', state.logs.length === 1 && state.logs[0]?.status === 'ok');
}

console.log('');
console.log('幂等（webhook 重试）：');
{
  const { app, env, state } = build();
  await app.request(genericPost('同一封', 'box@r0.us.ci', 'm-dup'), {}, env);
  const r2 = await app.request(genericPost('同一封', 'box@r0.us.ci', 'm-dup'), {}, env);
  const j = (await r2.json()) as { results: { status: string }[] };
  check('第二次是 duplicate', j.results?.[0]?.status === 'duplicate');
  check('没有重复入库', state.messages.length === 1);
  check('重复也回 200（不引发重试风暴）', r2.status === 200);
}

console.log('');
console.log('无人认领：');
{
  const { app, env, state } = build();
  const r = await app.request(genericPost('陌生地址', 'nobody@other.domain', 'm-orphan'), {}, env);
  const j = (await r.json()) as { results: { status: string; reason?: string }[] };
  check('状态 dropped', j.results?.[0]?.status === 'dropped');
  check('原因写明无人认领', (j.results?.[0]?.reason ?? '').includes('无人认领'));
  check('不入库', state.messages.length === 0);
  check('仍返回 200（关键：避免重试风暴）', r.status === 200);
  check('日志记一笔便于排查', state.logs.length === 1 && state.logs[0]?.status === 'dropped');
}

console.log('');
console.log('子地址 +tag：');
{
  const { app, env, state } = build();
  const r = await app.request(genericPost('带 tag', 'box+news@r0.us.ci', 'm-tag'), {}, env);
  const j = (await r.json()) as { results: { status: string }[] };
  check('+tag 地址也能匹配到归属', j.results?.[0]?.status === 'ok' && state.messages.length === 1);
}

console.log('');
console.log('其它来源与探测：');
{
  const { app, env, state } = build();
  const pm = new Request('https://mail.test/api/inbound/postmark?key=test-secret', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: 'john@example.com', To: 'box@r0.us.ci', Subject: 'Postmark 来信',
      TextBody: 'hi', MessageID: 'pm-1',
    }),
  });
  const r = await app.request(pm, {}, env);
  const j = (await r.json()) as { received: number; results: { status: string }[] };
  check('Postmark webhook 走同一条链路', r.status === 200 && j.received === 1 && j.results?.[0]?.status === 'ok');
  check('日志来源标记为 postmark', state.logs.some((l) => l.source === 'postmark'));
}
{
  const { app, env } = build();
  const r = await app.request('https://mail.test/api/inbound/generic', {}, env);
  check('GET 探测返回 200（服务商配置时会先验证 URL）', r.status === 200);
}
{
  const { app, env } = build();
  const r = await app.request('https://mail.test/api/inbound/nope?key=test-secret', { method: 'POST', body: '{}' }, env);
  check('未知来源 → 400', r.status === 400);
}
{
  // 具名路由不能被 /:source 通配抢走（Hono 按注册顺序匹配）
  const { app, env } = build();
  const r = await app.request('https://mail.test/api/inbound/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }, env);
  check('POST /test 落到管理接口而非 webhook 通配', r.status !== 400);
  const r2 = await app.request('https://mail.test/api/inbound/secret', { method: 'POST' }, env);
  check('POST /secret 落到管理接口而非 webhook 通配', r2.status !== 400);
}
{
  const { app, env } = build();
  const empty = new Request('https://mail.test/api/inbound/generic?key=test-secret', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  const r = await app.request(empty, {}, env);
  const j = (await r.json()) as { received: number };
  check('服务商验证请求（空 payload）→ 200 且 received=0', r.status === 200 && j.received === 0);
}

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} 项失败`);
