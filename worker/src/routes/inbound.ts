/**
 * 收信通道 API
 *
 * 域名没托管到 Cloudflare 时用不上 Email Routing，改由发信商的 inbound
 * webhook 或自建接口把信送进来。这个模块提供：
 *   - 公开的 webhook 端点（带密钥）
 *   - 管理员用的配置 / 日志 / 测试 / 拉取接口
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { qAll, exec, qOne } from '../db/query';
import { getAllSettings, setSettings, isTrue } from '../db/settings';
import { authRequired, adminOnly, type AppEnv } from '../middleware/auth';
import { randomToken } from '../lib/crypto';
import { parseInbound } from '../email/parse';
import { ingestInbound } from '../email/receive';
import { INBOUND_SOURCES, type InboundSource } from '../email/types';

type Ctx = { Bindings: Env; Variables: AppEnv['Variables'] };
const inbound = new Hono<Ctx>();

interface InboundLogRow {
  id: number;
  source: string;
  event_id: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  owner_id: number | null;
  message_id: number | null;
  status: string;
  reason: string;
  created_at: number;
}

/** 常量时间比较，避免密钥被逐字节爆破 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function providedKey(c: Context<Ctx>): string {
  const q = new URL(c.req.url).searchParams.get('key') ?? '';
  const h = c.req.header('x-inbound-key') ?? '';
  const auth = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return q || h || auth || '';
}

function expectedKey(env: Env, settings: Record<string, string>): string {
  return settings.inbound_secret || env.JWT_SECRET;
}

/** 从已配置的 Resend 服务商里自动取 API Key —— 配过发信就能收信，不用再填一遍 */
async function resendKeyFromProvider(env: Env): Promise<string> {
  try {
    const rows = await qAll<{ config: string }>(
      env.DB,
      "SELECT config FROM mail_provider WHERE kind = 'resend' AND enabled = 1 ORDER BY id LIMIT 1",
    );
    for (const r of rows) {
      const cfg = JSON.parse(r.config || '{}') as { apiKey?: string };
      if (cfg.apiKey) return cfg.apiKey;
    }
  } catch {
    /* 表还没建好 */
  }
  return '';
}

/* ── 公开 webhook ─────────────────────────────────────────────
 *
 * 各家配置界面都允许在 URL 里带 query，所以统一用 ?key=xxx。
 * 也支持 X-Inbound-Key / Authorization: Bearer，方便不能带 query 的场景
 * （例如 Mailgun 的 /json 后缀要求 URL 以 json 结尾）。
 *
 * 永远返回 200：Postmark 会重试 10 次、SendGrid 重试 3 天，
 * 一旦因为「地址无人认领」返回 4xx 就会引发重试风暴。
 */
async function webhookHandler(c: Context<Ctx>) {
  const source = String(c.req.param('source') ?? '').toLowerCase() as InboundSource;
  if (!INBOUND_SOURCES.includes(source) || source === 'cloudflare') {
    return c.json({ ok: false, error: '未知收信来源' }, 400);
  }

  const settings = await getAllSettings(c.env.DB);
  const given = providedKey(c);
  if (!safeEqual(given, expectedKey(c.env, settings))) {
    return c.json({ ok: false, error: '密钥不匹配' }, 401);
  }

  const mails = await parseInbound(source, c.req.raw, {
    env: c.env,
    settings,
    resendApiKey: await resendKeyFromProvider(c.env),
  });

  if (!mails.length) {
    return c.json({ ok: true, received: 0, note: '未解析出邮件（可能是服务商的验证请求）' });
  }

  const results: { status: string; reason?: string; messageId?: number }[] = [];
  for (const m of mails) {
    try {
      const r = await ingestInbound(c.env, m);
      results.push({ status: r.status, reason: r.reason, messageId: r.messageId });
    } catch (e) {
      console.error('inbound ingest failed', source, e);
      results.push({ status: 'error', reason: String(e) });
    }
  }
  return c.json({ ok: true, received: mails.length, results });
}

/* 通配的 webhook 路由必须放在所有具名路由之后：
 * Hono 按注册顺序匹配，若 /:source 在前，POST /secret、/test、/pull
 * 会被当成「来源叫 secret 的 webhook」而返回 401。 */

/* ── 管理员：配置 ─────────────────────────────────────────── */
inbound.get('/config', authRequired as never, adminOnly as never, async (c) => {
  const s = await getAllSettings(c.env.DB);
  const origin = new URL(c.req.url).origin;
  const secret = expectedKey(c.env, s);
  const autoKey = await resendKeyFromProvider(c.env);

  const sources = [
    {
      key: 'resend',
      label: 'Resend',
      mx: '在 Resend → Receiving 添加域名并按提示设置 MX',
      where: 'Webhooks 新增 endpoint，订阅 email.received 事件',
      note: 'webhook 只给元数据，系统会自动回拉正文与附件（需 Resend API Key）',
      url: `${origin}/api/inbound/resend?key=${encodeURIComponent(secret)}`,
    },
    {
      key: 'postmark',
      label: 'Postmark',
      mx: 'MX 指向 inbound.postmarkapp.com',
      where: 'Server → Inbound → 填 Inbound webhook URL',
      note: '支持 +tag 子地址，系统会自动去掉 tag 匹配归属',
      url: `${origin}/api/inbound/postmark?key=${encodeURIComponent(secret)}`,
    },
    {
      key: 'sendgrid',
      label: 'SendGrid',
      mx: '收信子域 MX 10 指向 mx.sendgrid.net',
      where: 'Settings → Inbound Parse → Add Host & URL',
      note: '建议勾选「POST the raw, full MIME message」，字段与附件最完整',
      url: `${origin}/api/inbound/sendgrid?key=${encodeURIComponent(secret)}`,
    },
    {
      key: 'mailgun',
      label: 'Mailgun',
      mx: 'MX 指向 Mailgun 提供的接收主机',
      where: 'Routes → forward() 到下面的 URL',
      note: 'URL 末尾加 /json 可拿 JSON；不加走表单，两种都能解析',
      url: `${origin}/api/inbound/mailgun?key=${encodeURIComponent(secret)}`,
    },
    {
      key: 'generic',
      label: '自建接口',
      mx: '不需要 MX',
      where: '你自己的服务器 / n8n / Zapier / curl 直接 POST',
      note: '最通用的一种，POST 一段 JSON 就能入库',
      url: `${origin}/api/inbound/generic?key=${encodeURIComponent(secret)}`,
    },
  ];

  return c.json(
    ok({
      origin,
      secret,
      customSecret: s.inbound_secret || '',
      usingJwtFallback: !s.inbound_secret,
      resendKeyConfigured: !!(s.inbound_resend_api_key || autoKey),
      resendKeySource: s.inbound_resend_api_key ? '收信通道设置' : autoKey ? '发信服务商（自动）' : '未配置',
      pollEnabled: isTrue(s.inbound_poll_enabled),
      cloudflareRouting: true,
      sources,
    }),
  );
});

/** 重新生成 webhook 密钥（会立即使旧 URL 失效） */
inbound.post('/secret', authRequired as never, adminOnly as never, async (c) => {
  const secret = randomToken(18);
  await setSettings(c.env.DB, { inbound_secret: secret });
  return c.json(ok({ secret }));
});

/** 入站日志 */
inbound.get('/log', authRequired as never, adminOnly as never, async (c) => {
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30)));
  const rows = await qAll<InboundLogRow>(
    c.env.DB,
    'SELECT * FROM inbound_log ORDER BY id DESC LIMIT ?',
    limit,
  ).catch(() => [] as InboundLogRow[]);
  return c.json(ok(rows));
});

/** 端到端测试：走自建接口那条链路，验证归属匹配 / AI 侦测 / 入库 / 分发 */
inbound.post('/test', authRequired as never, adminOnly as never, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { to?: string; spam?: boolean };
  const s = await getAllSettings(c.env.DB);
  const to = body.to || (await qOne<{ address: string }>(
    c.env.DB,
    'SELECT address FROM mail_address WHERE enabled = 1 ORDER BY id LIMIT 1',
  ).catch(() => null))?.address;
  if (!to) throw new HttpError('没有可用的邮箱地址，请先在「邮箱 → 邮箱地址」创建一个');

  const spam = body.spam === true;
  const mail = {
    from: spam ? 'winner@promo-deals.example' : 'test@example.com',
    fromName: spam ? 'Prize Team' : 'Henna 测试',
    to: [to],
    subject: spam
      ? 'Congratulations! You have WON a FREE gift!!! Act now'
      : '收信通道测试 · 这封信来自发信商 webhook',
    text: spam
      ? 'Limited time offer, claim your prize. 100% free, guaranteed return. Click here now!'
      : '如果你在收件箱（或垃圾箱）看到这封信，说明收信通道已打通。',
    messageId: `test-${Date.now()}-${randomToken(4)}@henna.local`,
    eventId: `test-${Date.now()}-${randomToken(4)}`,
    source: 'generic',
  };
  const r = await ingestInbound(c.env, { ...mail, size: mail.text.length });
  return c.json(ok({ ...r, to, note: r.status === 'ok' ? '已入库，去收件箱/垃圾箱查看' : r.reason }));
});

/**
 * 主动拉取：Resend 会把收到的邮件存起来，即使 webhook 没配或端点挂了。
 * 调 GET /emails/receiving 拉列表，逐封回拉正文入库。
 * 去重靠 email_id → external_id，重复执行不会重复入库。
 */
inbound.post('/pull', authRequired as never, adminOnly as never, async (c) => {
  const s = await getAllSettings(c.env.DB);
  const key = s.inbound_resend_api_key || (await resendKeyFromProvider(c.env));
  if (!key) throw new HttpError('未配置 Resend API Key：在收信通道填写，或先添加一个 Resend 发信服务商');

  const body = (await c.req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 20)));
  const r = await fetch(`https://api.resend.com/emails/receiving?limit=${limit}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new HttpError(`Resend 返回 HTTP ${r.status}：${(await r.text()).slice(0, 160)}`);
  const j = (await r.json()) as { data?: Record<string, unknown>[]; has_more?: boolean };

  const out: { id: string; status: string; reason?: string }[] = [];
  for (const e of j.data ?? []) {
    const id = String(e.id ?? '');
    if (!id) continue;
    // 伪造一封和 webhook 等价的事件，复用同一个解析器（含正文/附件回拉）
    const fake = new Request('https://local/api/inbound/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email.received', data: e }),
    });
    const mails = await parseInbound('resend', fake, { env: c.env, settings: s, resendApiKey: key });
    for (const m of mails) {
      const res = await ingestInbound(c.env, m);
      out.push({ id, status: res.status, reason: res.reason });
    }
  }
  return c.json(ok({ fetched: j.data?.length ?? 0, hasMore: !!j.has_more, results: out }));
});

/** 定时拉取（cron 调用），失败不影响日常维护任务 */
export async function pollInbound(env: Env): Promise<{ fetched: number; skipped?: string }> {
  const s = await getAllSettings(env.DB);
  if (!isTrue(s.inbound_poll_enabled)) return { fetched: 0, skipped: '未开启' };
  const key = s.inbound_resend_api_key || (await resendKeyFromProvider(env));
  if (!key) return { fetched: 0, skipped: '未配置 Resend API Key' };
  try {
    const r = await fetch('https://api.resend.com/emails/receiving?limit=20', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { fetched: 0, skipped: `HTTP ${r.status}` };
    const j = (await r.json()) as { data?: Record<string, unknown>[] };
    let n = 0;
    for (const e of j.data ?? []) {
      const fake = new Request('https://local/api/inbound/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'email.received', data: e }),
      });
      const mails = await parseInbound('resend', fake, { env, settings: s, resendApiKey: key });
      for (const m of mails) {
        const res = await ingestInbound(env, m);
        if (res.status === 'ok') n++;
      }
    }
    return { fetched: n };
  } catch (e) {
    return { fetched: 0, skipped: String(e) };
  }
}

/* ── 公开 webhook（放最后，避免抢走上面的具名路由） ─────────── */
inbound.post('/:source/json', webhookHandler as never);
inbound.post('/:source', webhookHandler as never);
// 有些服务商配置时会先 GET 探测 URL
inbound.get('/:source/json', () => new Response('ok', { status: 200 }));
inbound.get('/:source', () => new Response('ok', { status: 200 }));

export default inbound;
