#!/usr/bin/env node
/**
 * 预览用本地服务：静态托管 web/dist，并对 /api/* 返回演示数据。
 * 仅用于生成界面预览图，不参与部署。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'web/dist');
const PORT = Number(process.env.PORT ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const DOMAIN = 'henna.dev';

const now = Date.now();
const min = (n) => now - n * 60000;

const MESSAGES = (box) =>
  box === 'out'
    ? [
        { id: 901, direction: 'out', from_addr: `ops@${DOMAIN}`, from_name: 'Ops', to_addr: 'team@example.com', subject: '本周发信通道健康度报告', is_read: 1, is_star: 0, size: 4820, created_at: min(38) },
        { id: 902, direction: 'out', from_addr: `billing@${DOMAIN}`, from_name: '', to_addr: 'client@corp.com', subject: 'Invoice #H-2408 已开具', is_read: 1, is_star: 1, size: 9120, created_at: min(160) },
      ]
    : [
        { id: 101, direction: 'in', from_addr: 'no-reply@github.com', from_name: 'GitHub', to_addr: `dev@${DOMAIN}`, subject: '[Henna] 你的部署已上线 · workflow #128', is_read: 0, is_star: 0, size: 12480, created_at: min(6) },
        { id: 102, direction: 'in', from_addr: 'security@stripe.com', from_name: 'Stripe', to_addr: `billing@${DOMAIN}`, subject: '你的验证码是 482913', is_read: 0, is_star: 1, size: 3120, created_at: min(24) },
        { id: 103, direction: 'in', from_addr: 'news@cloudflare.com', from_name: 'Cloudflare', to_addr: `ops@${DOMAIN}`, subject: 'Workers 配额使用情况提醒', is_read: 1, is_star: 0, size: 8640, created_at: min(75) },
        { id: 104, direction: 'in', from_addr: 'support@resend.com', from_name: 'Resend', to_addr: `ops@${DOMAIN}`, subject: 'API Key 即将到期，请及时轮换', is_read: 1, is_star: 0, size: 4210, created_at: min(190) },
        { id: 105, direction: 'in', from_addr: 'team@figma.com', from_name: 'Figma', to_addr: `design@${DOMAIN}`, subject: '邀请你加入「Henna 设计规范」', is_read: 1, is_star: 0, size: 15230, created_at: min(420) },
        { id: 106, direction: 'in', from_addr: 'alerts@telegram.org', from_name: 'Telegram', to_addr: `notify@${DOMAIN}`, subject: 'Bot token 已更新', is_read: 1, is_star: 0, size: 2870, created_at: min(760) },
      ];

const DETAIL = {
  101: {
    id: 101, direction: 'in', from_addr: 'no-reply@github.com', from_name: 'GitHub',
    to_addr: `dev@${DOMAIN}`, subject: '[Henna] 你的部署已上线 · workflow #128',
    is_read: 1, is_star: 0, size: 12480, created_at: min(6),
    html_body: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;color:#1c1917">
      <h2 style="color:#b4462f;margin:0 0 12px">部署成功</h2>
      <p>工作流 <b>Deploy Henna Mail</b> 已成功部署到 Cloudflare Workers。</p>
      <table style="border-collapse:collapse;margin:16px 0;font-size:14px">
        <tr><td style="padding:6px 16px 6px 0;color:#57534e">提交</td><td><code>a7f3c21</code> 渲染 wrangler 配置</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#57534e">耗时</td><td>42s</td></tr>
        <tr><td style="padding:6px 16px 6px 0;color:#57534e">环境</td><td>production · apac</td></tr>
      </table>
      <a href="#" style="display:inline-block;background:#b4462f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:14px">查看完整日志</a>
      <p style="margin-top:24px;color:#57534e;font-size:12px">你收到这封邮件是因为 dev@${DOMAIN} 订阅了部署通知。</p>
    </div>`,
    text_body: null,
    attachments: [{ id: 1, name: 'deploy-log.txt', mime: 'text/plain', size: 2048 }],
  },
};

const PROVIDERS = [
  { id: 1, name: 'Resend 主通道', kind: 'resend', label: 'Resend', enabled: 1, weight: 100, daily_used: 128, last_error: null, config: { apiKey: '••••••••' } },
  { id: 2, name: 'SendGrid 备用', kind: 'sendgrid', label: 'SendGrid', enabled: 1, weight: 80, daily_used: 34, last_error: null, config: { apiKey: '••••••••' } },
  { id: 3, name: 'Mailgun EU', kind: 'mailgun', label: 'Mailgun', enabled: 1, weight: 60, daily_used: 12, last_error: null, config: { apiKey: '••••••••', domain: `mg.${DOMAIN}`, region: 'eu' } },
  { id: 4, name: 'Cloudflare Email Service', kind: 'cloudflare', label: 'Cloudflare Email Service', enabled: 1, weight: 90, daily_used: 0, last_error: null, config: {} },
  { id: 5, name: 'Noop 自测通道', kind: 'noop', label: 'Noop（自测，不真发）', enabled: 0, weight: 1, daily_used: 0, last_error: null, config: {} },
];

const ADDRESSES = [
  { id: 1, user_id: 1, address: `dev@${DOMAIN}`, domain: DOMAIN, enabled: 1, created_at: min(9000) },
  { id: 2, user_id: 1, address: `ops@${DOMAIN}`, domain: DOMAIN, enabled: 1, created_at: min(8800) },
  { id: 3, user_id: 1, address: `billing@${DOMAIN}`, domain: DOMAIN, enabled: 1, created_at: min(8600) },
  { id: 4, user_id: 2, address: `design@${DOMAIN}`, domain: DOMAIN, enabled: 1, created_at: min(7000), owner: 'designer@x.com' },
  { id: 5, user_id: 3, address: `notify@${DOMAIN}`, domain: DOMAIN, enabled: 0, created_at: min(6000), owner: 'bot@x.com' },
];

const RULES = [
  { id: 1, user_id: 1, name: '验证码 → Telegram', match_address: '', match_from: '', match_subject: '验证码', action: 'telegram', target: '8123:AAH***:-1002***', enabled: 1, created_at: min(5000) },
  { id: 2, user_id: 1, name: '账单邮件 → Webhook', match_address: `billing@${DOMAIN}`, match_from: '', match_subject: 'Invoice', action: 'webhook', target: 'https://hooks.internal/henna/billing', enabled: 1, created_at: min(4000) },
  { id: 3, user_id: 1, name: '告警转发到 Gmail', match_address: '', match_from: 'alerts', match_subject: '', action: 'forward', target: 'ops@gmail.com', enabled: 0, created_at: min(3000) },
];

const LOGS = [
  { id: 1, provider: 'Resend 主通道', from_addr: `ops@${DOMAIN}`, to_addr: 'team@example.com', subject: '本周发信通道健康度报告', status: 'success', error: null, created_at: min(38) },
  { id: 2, provider: 'SendGrid 备用', from_addr: `billing@${DOMAIN}`, to_addr: 'client@corp.com', subject: 'Invoice #H-2408 已开具', status: 'success', error: null, created_at: min(160) },
  { id: 3, provider: 'Mailgun EU', from_addr: `dev@${DOMAIN}`, to_addr: 'a@b.com', subject: 'Weekly digest', status: 'failed', error: 'domain not verified', created_at: min(300) },
  { id: 4, provider: 'Resend 主通道', from_addr: `ops@${DOMAIN}`, to_addr: 'x@y.com', subject: '配额提醒', status: 'success', error: null, created_at: min(520) },
];

const USERS = [
  { id: 1, email: `admin@${DOMAIN}`, role: 'admin', quota: 200, used: 62, status: 'active', created_at: min(9000) },
  { id: 2, email: 'designer@x.com', role: 'user', quota: 50, used: 12, status: 'active', created_at: min(7000) },
  { id: 3, email: 'bot@x.com', role: 'user', quota: 50, used: 0, status: 'active', created_at: min(6000) },
];

const INVITES = [
  { id: 1, code: 'H7K2QX', role: 'user', quota: 50, max_use: 1, used: 0, expire_at: now + 6 * 86400000 },
  { id: 2, code: 'M4P9ZD', role: 'user', quota: 50, max_use: 1, used: 1, expire_at: now + 6 * 86400000 },
  { id: 3, code: 'B8T1WR', role: 'admin', quota: 200, max_use: 1, used: 0, expire_at: now + 6 * 86400000 },
  { id: 4, code: 'Y3N6LC', role: 'user', quota: 50, max_use: 1, used: 0, expire_at: now + 2 * 86400000 },
];

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, data }));
}

const routes = {
  '/api/system/config': () => ({ appName: 'Henna Mail', domains: [DOMAIN], allowRegister: true, strategy: 'priority' }),
  '/api/auth/me': () => ({ id: 1, email: `admin@${DOMAIN}`, role: 'admin', quota: 200, used: 62, api_key: 'hn_9f2a1c8e4b7d6053' }),
  '/api/mailbox': () => ADDRESSES,
  '/api/provider': () => PROVIDERS,
  '/api/provider/meta': () => [
    { kind: 'resend', label: 'Resend', docs: 'https://resend.com/docs', fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }, { key: 'defaultFrom', label: '默认发件人', type: 'text' }] },
    { kind: 'sendgrid', label: 'SendGrid', docs: '', fields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }] },
  ],
  '/api/rule': () => RULES,
  '/api/send/logs': () => LOGS,
  '/api/admin/users': () => USERS,
  '/api/admin/invite': () => INVITES,
  '/api/admin/stats': () => ({
    users: 3, inbox: 1428, outbox: 613, providers: 4, addresses: 5, failed: 7,
    trend: Array.from({ length: 14 }, (_, i) => ({ d: `2026-10-${String(i + 4).padStart(2, '0')}`, n: 20 + Math.round(Math.sin(i) * 12 + i * 3) })),
    byProvider: [{ provider: 'Resend 主通道', n: 402 }, { provider: 'SendGrid 备用', n: 148 }, { provider: 'Mailgun EU', n: 63 }],
  }),
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    if (routes[p]) return json(res, routes[p]());
    const m = /^\/api\/message\/(\d+)$/.exec(p);
    if (m) return json(res, DETAIL[m[1]] ?? { ...MESSAGES('in')[0], html_body: '<p>正文内容</p>', text_body: null, attachments: [] });
    const box = url.searchParams.get('box');
    if (p === '/api/message') return json(res, MESSAGES(box === 'out' ? 'out' : 'in'));
    return json(res, {});
  }

  // 静态资源（SPA fallback）
  let file = path.join(ROOT, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

server.listen(PORT, () => console.log(`preview server: http://localhost:${PORT}`));
