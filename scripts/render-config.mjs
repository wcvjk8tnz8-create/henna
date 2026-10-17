#!/usr/bin/env node
/**
 * 把资源 ID 与运行时变量写入 worker/wrangler.jsonc（幂等，可重复执行）。
 *
 * 环境变量：D1_ID, KV_ID, R2_BUCKET, JWT_SECRET, ADMIN_EMAIL, MAIL_DOMAINS
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('worker/wrangler.jsonc');
let src = fs.readFileSync(file, 'utf8');

const D1_ID = process.env.D1_ID;
const KV_ID = process.env.KV_ID;
const R2 = process.env.R2_BUCKET;
const JWT = process.env.JWT_SECRET;
const ADMIN = process.env.ADMIN_EMAIL;
const DOMAINS = process.env.MAIL_DOMAINS;

function setPlaceholder(key, value) {
  if (!value) return;
  const re = new RegExp(`"${key}"\\s*:\\s*"[^"]*"`);
  src = re.test(src) ? src.replace(re, `"${key}": "${value}"`) : src;
}

// 资源绑定
src = src.replace(/"REPLACE_D1_DATABASE_ID"/g, `"${D1_ID ?? 'REPLACE_D1_DATABASE_ID'}"`);
src = src.replace(/"REPLACE_KV_NAMESPACE_ID"/g, `"${KV_ID ?? 'REPLACE_KV_NAMESPACE_ID'}"`);
if (R2) src = src.replace(/"bucket_name":\s*"[^"]*"/, `"bucket_name": "${R2}"`);

// 运行时变量
setPlaceholder('JWT_SECRET', JWT);
setPlaceholder('ADMIN_EMAIL', ADMIN);
if (DOMAINS) {
  const json = JSON.stringify(DOMAINS); // 已是 JSON 数组字符串
  try {
    const arr = JSON.parse(DOMAINS);
    src = src.replace(/"MAIL_DOMAINS":\s*"[^"]*"/, `"MAIL_DOMAINS": ${JSON.stringify(JSON.stringify(arr))}`);
  } catch {
    src = src.replace(/"MAIL_DOMAINS":\s*"[^"]*"/, `"MAIL_DOMAINS": ${JSON.stringify(json)}`);
  }
}

fs.writeFileSync(file, src);
console.log('✓ wrangler.jsonc 已渲染');
