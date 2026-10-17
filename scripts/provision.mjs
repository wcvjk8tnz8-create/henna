#!/usr/bin/env node
/**
 * 自动创建 / 复用 Cloudflare 资源：D1、KV、R2。
 * 输出写入 $GITHUB_OUTPUT（CI）或 stdout（本地），供后续步骤渲染配置。
 *
 * 依赖环境变量：CF_API_TOKEN, CF_ACCOUNT_ID
 */
import fs from 'node:fs';

const TOKEN = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;

if (!TOKEN || !ACCOUNT) {
  console.error('✗ 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID');
  process.exit(1);
}

const BASE = 'https://api.cloudflare.com/client/v4';
const D1_NAME = process.env.D1_NAME || 'henna-mail-db';
const KV_NAME = process.env.KV_NAME || 'henna-mail-kv';
const R2_NAME = process.env.R2_BUCKET_NAME || 'henna-mail-r2';

async function cf(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return res.json();
}

async function upsertD1() {
  const list = await cf(`/accounts/${ACCOUNT}/d1/database?name=${encodeURIComponent(D1_NAME)}`);
  const found = (list.result || []).find((d) => d.name === D1_NAME);
  if (found) return found.uuid;
  const created = await cf(`/accounts/${ACCOUNT}/d1/database`, {
    method: 'POST',
    body: JSON.stringify({ name: D1_NAME, primary_location_hint: 'apac' }),
  });
  if (!created.success) throw new Error(`创建 D1 失败: ${JSON.stringify(created.errors)}`);
  return created.result.uuid;
}

async function upsertKV() {
  const list = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces`);
  const found = (list.result || []).find((n) => n.title === KV_NAME);
  if (found) return found.id;
  const created = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces`, {
    method: 'POST',
    body: JSON.stringify({ title: KV_NAME }),
  });
  if (!created.success) throw new Error(`创建 KV 失败: ${JSON.stringify(created.errors)}`);
  return created.result.id;
}

async function upsertR2() {
  const list = await cf(`/accounts/${ACCOUNT}/r2/buckets?name=${encodeURIComponent(R2_NAME)}`);
  const found = (list.result?.buckets || []).find((b) => b.name === R2_NAME);
  if (found) return found.name;
  const created = await cf(`/accounts/${ACCOUNT}/r2/buckets`, {
    method: 'POST',
    body: JSON.stringify({ name: R2_NAME, locationHint: 'apac' }),
  });
  if (!created.success) throw new Error(`创建 R2 失败: ${JSON.stringify(created.errors)}`);
  return created.result.name;
}

const [d1Id, kvId, r2Bucket] = await Promise.all([upsertD1(), upsertKV(), upsertR2()]);
console.log(`✓ D1 ${d1Id}\n✓ KV ${kvId}\n✓ R2 ${r2Bucket}`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `d1_id=${d1Id}\nkv_id=${kvId}\nr2_bucket=${r2Bucket}\n`,
  );
} else {
  // 本地脚本模式：直接落盘，供 deploy.sh 读取
  fs.writeFileSync(
    '/tmp/henna-resources.env',
    `D1_ID=${d1Id}\nKV_ID=${kvId}\nR2_BUCKET=${r2Bucket}\n`,
  );
}

// 输出 worker 子域，方便拼接访问地址
let subdomain = '';
try {
  const sub = await cf(`/accounts/${ACCOUNT}/workers/subdomain`);
  subdomain = sub.result?.subdomain ?? '';
  console.log(`✓ workers.dev 子域: ${subdomain}.workers.dev`);
} catch {
  /* ignore */
}
if (process.env.GITHUB_OUTPUT && subdomain) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `subdomain=${subdomain}\n`);
}
