#!/usr/bin/env node
/**
 * 把资源 ID 与运行时变量写入 worker/wrangler.jsonc（幂等，可重复执行）。
 *
 * 环境变量：D1_ID, KV_ID, R2_BUCKET, JWT_SECRET, ADMIN_EMAIL, MAIL_DOMAINS
 *
 * 实现方式：先解析为 JS 对象 → 改字段 → 重新序列化。
 * 绝不用正则去改 JSON 字符串——值里一旦含转义引号就会写出非法 JSON。
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeDomains } from './normalize-domains.mjs';

const file = path.resolve('worker/wrangler.jsonc');
const original = fs.readFileSync(file, 'utf8');

/** 去掉 // 与 /* *\/ 注释，便于 JSON.parse（不影响字符串内的 //） */
function stripComments(s) {
  let out = '';
  let inStr = false;
  let esc = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const n = s[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i++; }
      continue;
    }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

let cfg;
try {
  cfg = JSON.parse(stripComments(original));
} catch (e) {
  console.error('✗ wrangler.jsonc 本身不是合法 JSON：', e.message);
  process.exit(1);
}

// 域名解析统一交给 normalize-domains.mjs，避免两套规则不一致
const parsedDomains = process.env.MAIL_DOMAINS
  ? normalizeDomains(process.env.MAIL_DOMAINS)
  : null;
if (parsedDomains && !parsedDomains.ok) {
  console.error('✗', parsedDomains.error);
  process.exit(1);
}
const DOMAIN_LIST = parsedDomains?.ok ? parsedDomains.domains : null;

const D1_ID = process.env.D1_ID;
const KV_ID = process.env.KV_ID;
const R2 = process.env.R2_BUCKET;
const JWT = process.env.JWT_SECRET;
const ADMIN = process.env.ADMIN_EMAIL;

// ── 资源绑定
if (D1_ID && Array.isArray(cfg.d1_databases) && cfg.d1_databases[0]) {
  cfg.d1_databases[0].database_id = D1_ID;
}
if (KV_ID && Array.isArray(cfg.kv_namespaces) && cfg.kv_namespaces[0]) {
  cfg.kv_namespaces[0].id = KV_ID;
}
if (R2 && Array.isArray(cfg.r2_buckets) && cfg.r2_buckets[0]) {
  cfg.r2_buckets[0].bucket_name = R2;
}

// ── 运行时变量（wrangler.jsonc 里存数组字符串，由 worker 自行解析；
//    用户侧填的是逗号串，已在 normalize-domains.mjs 归一化）
cfg.vars = cfg.vars || {};
if (JWT) cfg.vars.JWT_SECRET = JWT;
if (ADMIN) cfg.vars.ADMIN_EMAIL = ADMIN;
if (DOMAIN_LIST) cfg.vars.MAIL_DOMAINS = JSON.stringify(DOMAIN_LIST);

fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');

// ── 自检
try {
  JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('✓ wrangler.jsonc 已渲染');
  console.log('  D1       :', cfg.d1_databases?.[0]?.database_id);
  console.log('  KV       :', cfg.kv_namespaces?.[0]?.id);
  console.log('  R2       :', cfg.r2_buckets?.[0]?.bucket_name);
  console.log('  ADMIN    :', cfg.vars.ADMIN_EMAIL);
  console.log('  DOMAINS  :', cfg.vars.MAIL_DOMAINS);
} catch (e) {
  console.error('✗ 渲染结果非法：', e.message);
  process.exit(1);
}
