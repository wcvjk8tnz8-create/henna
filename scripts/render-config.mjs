#!/usr/bin/env node
/**
 * 把资源 ID 与运行时变量写入 worker/wrangler.jsonc（幂等，可重复执行）。
 *
 * 环境变量：D1_ID, KV_ID, R2_BUCKET, JWT_SECRET, ADMIN_EMAIL, MAIL_DOMAINS
 * MAIL_DOMAINS 容错：JSON 数组 / 逗号分隔 / 单个域名 / 带引号或星号都吃
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

/** 把任意写法的域名输入规整成 string[] */
function parseDomains(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s || s === '[]' || s === '""' || s === "''") return null;

  // 先尝试当 JSON 数组解析
  try {
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) {
      const out = arr.map(String).map((x) => x.trim()).filter(Boolean);
      if (out.length) return out;
    }
  } catch {
    /* 不是合法 JSON，走下面的宽松解析 */
  }

  // 宽松解析：去掉 [] " ' 等包裹符，再按逗号/空白切分
  const out = s
    .replace(/^\[|\]$/g, '')
    .replace(/["']/g, '')
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  return out.length ? out : null;
}

const DOMAIN_LIST = parseDomains(process.env.MAIL_DOMAINS);

/**
 * 替换某个 key 的字符串值。
 * 值部分用 `"(?:[^"\\]|\\.)*"` 匹配，才能正确处理值内被转义的引号
 * （旧版用 `"[^"]*"` 会在 \" 处截断，写出非法 JSON）。
 */
function setString(key, value) {
  if (value === undefined || value === null || value === '') return;
  const re = new RegExp(`("${key}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
  const next = `${key} 占位`;
  if (!re.test(src)) {
    console.warn(`! 未在 wrangler.jsonc 中找到 ${key}，跳过`);
    return;
  }
  // 先占位再替换，避免 $& 等特殊序列被当成替换模式
  src = src.replace(re, (_m, head) => `${head}"${String(value).replace(/"/g, '\\"')}"`);
  void next;
}

// ── 资源绑定
src = src.replace(/"REPLACE_D1_DATABASE_ID"/g, `"${D1_ID ?? 'REPLACE_D1_DATABASE_ID'}"`);
src = src.replace(/"REPLACE_KV_NAMESPACE_ID"/g, `"${KV_ID ?? 'REPLACE_KV_NAMESPACE_ID'}"`);
if (R2) src = src.replace(/("bucket_name"\s*:\s*)"(?:[^"\\]|\\.)*"/, (_m, head) => `${head}"${R2}"`);

// ── 运行时变量
setString('JWT_SECRET', JWT);
setString('ADMIN_EMAIL', ADMIN);
if (DOMAIN_LIST) {
  const asString = JSON.stringify(DOMAIN_LIST); // '["a.com","b.com"]'
  setString('MAIL_DOMAINS', asString);
  console.log(`✓ MAIL_DOMAINS = ${asString}`);
} else {
  console.warn('! MAIL_DOMAINS 为空，沿用配置默认值；发信域名白名单需要后续手动改');
}

fs.writeFileSync(file, src);

// ── 写回前自检：确认能作为 JSON 解析（去掉注释后）
try {
  const stripped = src
    .replace(/\\"|"(?:\\"|[^"])*"/g, (m) => (m.startsWith('\\') ? m : '""'))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  JSON.parse(stripped);
  console.log('✓ wrangler.jsonc 已渲染且 JSON 结构自检通过');
} catch (e) {
  console.error('✗ 渲染后 JSON 结构非法：', e.message);
  console.error(src);
  process.exit(1);
}
