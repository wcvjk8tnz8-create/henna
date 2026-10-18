#!/usr/bin/env node
/**
 * 自动创建 / 复用 Cloudflare 资源：D1、KV、R2。
 *
 * 走 REST API 而非 wrangler CLI —— CLI 各版本输出格式不一致
 * （v3 的 `r2 bucket list` 甚至不支持 --json），解析起来不可靠。
 *
 * 行为：
 *   填了 ID      → 直接用，不做任何创建
 *   没填 ID      → 按名字查找，找不到就自动创建
 *   R2 不可用    → 优雅跳过（免费额度需绑卡），其余功能不受影响
 *
 * 依赖环境变量：CF_API_TOKEN / CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID / CLOUDFLARE_ACCOUNT_ID
 * 可选：NAME, D1_DATABASE_ID, KV_NAMESPACE_ID, R2_BUCKET_NAME
 */
import fs from 'node:fs';

const TOKEN =
  process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_TOKEN;
const ACCOUNT =
  process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT;

if (!TOKEN || !ACCOUNT) {
  console.error('✗ 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

const NAME = process.env.NAME || 'henna-mail';
const D1_NAME = process.env.D1_NAME || `${NAME}-db`;
const KV_TITLE = process.env.KV_TITLE || `${NAME}-kv`;
const R2_NAME = process.env.R2_BUCKET_NAME || `${NAME}-r2`;

const BASE = 'https://api.cloudflare.com/client/v4';

async function cf(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, json, status: res.status };
}

async function upsertD1() {
  const provided = (process.env.D1_DATABASE_ID || '').trim();
  if (provided) {
    console.log(`✓ D1 使用指定 ID：${provided}`);
    return { id: provided, created: false };
  }
  const list = await cf(`/accounts/${ACCOUNT}/d1/database?per_page=100`);
  const found = (list.json.result || []).find((d) => d.name === D1_NAME);
  if (found) {
    console.log(`✓ D1 已存在：${D1_NAME} (${found.uuid})`);
    return { id: found.uuid, created: false };
  }
  const created = await cf(`/accounts/${ACCOUNT}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: D1_NAME, primary_location_hint: 'apac' }),
  });
  const id = created.json?.result?.uuid;
  if (!id) {
    console.error(`✗ 创建 D1 失败：${JSON.stringify(created.json?.errors ?? created.json)}`);
    process.exit(1);
  }
  console.log(`✓ D1 已创建：${D1_NAME} (${id})`);
  return { id, created: true };
}

async function upsertKV() {
  const provided = (process.env.KV_NAMESPACE_ID || '').trim();
  if (provided) {
    console.log(`✓ KV 使用指定 ID：${provided}`);
    return { id: provided, created: false };
  }
  const list = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`);
  const found = (list.json.result || []).find((n) => n.title === KV_TITLE);
  if (found) {
    console.log(`✓ KV 已存在：${KV_TITLE} (${found.id})`);
    return { id: found.id, created: false };
  }
  const created = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ title: KV_TITLE }),
  });
  const id = created.json?.result?.id;
  if (!id) {
    console.error(`✗ 创建 KV 失败：${JSON.stringify(created.json?.errors ?? created.json)}`);
    process.exit(1);
  }
  console.log(`✓ KV 已创建：${KV_TITLE} (${id})`);
  return { id, created: true };
}

/**
 * R2 是可选的：免费额度需绑卡，部分账户不可用。
 * 成功返回桶名，失败返回 null —— 由调用方决定降级，绝不阻断部署。
 */
async function upsertR2() {
  const list = await cf(`/accounts/${ACCOUNT}/r2/buckets?per_page=100`);
  if (!list.ok) {
    const codes = (list.json.errors || []).map((e) => e.code).join(',');
    const msg = (list.json.errors || []).map((e) => `${e.code} ${e.message}`).join('; ');
    console.warn(`! R2 不可用（HTTP ${list.status}${codes ? ' / ' + codes : ''}）：${msg || '未知错误'}`);
    console.warn('  最常见原因：API 令牌缺少 R2 权限。');
    console.warn('  解决：Cloudflare → 我的个人资料 → API 令牌 → 编辑该令牌 → 添加');
    console.warn('        「账户 / R2 存储桶 / 编辑」，或把 Workers R2 相关权限勾上。');
    console.warn('  也可以直接在 Secrets 里填 R2_BUCKET_NAME 指定已有桶（仍需读权限来校验）。');
    console.warn('  → 本次将跳过附件存储，其余功能不受影响。');
    return null;
  }
  const buckets = list.json.result?.buckets || [];
  if (buckets.some((b) => b.name === R2_NAME)) {
    console.log(`✓ R2 已存在：${R2_NAME}`);
    return R2_NAME;
  }
  const created = await cf(`/accounts/${ACCOUNT}/r2/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name: R2_NAME }),
  });
  if (!created.ok || !created.json?.result?.name) {
    const msg = (created.json.errors || []).map((e) => `${e.code} ${e.message}`).join('; ');
    console.warn(`! 创建 R2 桶失败（${msg || created.status}），将跳过附件存储`);
    console.warn('  若是权限报错，请给 API 令牌加上「R2 存储桶 / 编辑」后重跑。');
    return null;
  }
  console.log(`✓ R2 已创建：${R2_NAME}`);
  return R2_NAME;
}

const d1 = await upsertD1();
const kv = await upsertKV();
const r2 = await upsertR2();

if (!d1.id) {
  console.error('✗ D1 database_id 为空，无法继续');
  process.exit(1);
}
if (!kv.id) {
  console.error('✗ KV namespace id 为空，无法继续');
  process.exit(1);
}

let subdomain = '';
try {
  const sub = await cf(`/accounts/${ACCOUNT}/workers/subdomain`);
  subdomain = sub.json?.result?.subdomain ?? '';
  if (subdomain) console.log(`✓ workers.dev 子域：${subdomain}.workers.dev`);
} catch {
  /* 拿不到也没关系，部署步骤会从日志里提取 URL */
}

const out = {
  d1_id: d1.id,
  kv_id: kv.id,
  r2_bucket: r2 ?? '',
  r2_enabled: r2 ? 'true' : 'false',
  subdomain,
};

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(out)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n',
  );
}
fs.writeFileSync(
  '/tmp/henna-resources.env',
  Object.entries(out)
    .map(([k, v]) => `${k.toUpperCase()}=${v}`)
    .join('\n') + '\n',
);

console.log('\n──────── 资源摘要 ────────');
console.log(`D1  : ${d1.id}`);
console.log(`KV  : ${kv.id}`);
console.log(`R2  : ${r2 || '未启用（附件功能降级）'}`);
