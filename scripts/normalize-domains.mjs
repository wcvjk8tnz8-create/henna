#!/usr/bin/env node
/**
 * 域名输入归一化：把「随便怎么写」统一成 TOML 原生数组字面量。
 *
 * 设计目的：填配置的人不该被 JSON 语法折腾。
 *   ✅ r0.us.ci,v-1.top          ← 推荐写法
 *   ✅ r0.us.ci, v-1.top
 *   ✅ r0.us.ci v-1.top
 *   ✅ ["r0.us.ci","v-1.top"]    ← 旧格式，继续兼容
 *   ✅ ["r0.us.ci","v-1".top]    ← 引号点错位的笔误也能救回来
 *   ✅ r0.us.ci
 *   ❌ 空 / [] / 含非法字符
 *
 * CLI 用法（部署脚本用）：
 *   DOMAIN_JSON=$(node scripts/normalize-domains.mjs "$DOMAIN")
 *   stdout 输出 ["a.com","b.net"]，stderr 输出人类可读信息，失败 exit 1
 *
 * 输出只允许 [a-z0-9.\-*"',] —— 不含 \ & | 换行，
 * 因此可以安全地直接作为 sed 的替换文本，不会注入。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const DOMAIN_RE =
  /^(?=.{1,253}$)(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

const HINT = '请直接填域名，多个用逗号隔开，例如：r0.us.ci,v-1.top';

/**
 * @returns {{ ok: true, domains: string[], json: string } | { ok: false, error: string }}
 */
export function normalizeDomains(raw) {
  let s = String(raw ?? '').trim();
  if (!s || s === '[]' || s === 'null' || s === '""' || s === "''") {
    return { ok: false, error: `DOMAIN 为空。${HINT}` };
  }

  const parts = [];

  // 先试标准 JSON：数组直接用，字符串则当作逗号串再走一遍
  let asJson = null;
  try {
    asJson = JSON.parse(s);
  } catch {
    /* 不是 JSON，走宽松文本解析 */
  }
  if (Array.isArray(asJson)) {
    for (const x of asJson) parts.push(String(x));
  } else if (typeof asJson === 'string') {
    s = asJson;
  }

  if (!parts.length) {
    // 宽松文本：去掉包裹方括号与所有引号，再按逗号 / 空白 / 分号 / 顿号切分。
    // 这一步能把 ["a.com","b".net] 这类笔误还原成 a.com,b.net。
    const cleaned = s
      .replace(/^\s*\[/, '')
      .replace(/\]\s*$/, '')
      .replace(/["'`]/g, '');
    for (const x of cleaned.split(/[\s,;、]+/)) parts.push(x);
  }

  const domains = [];
  const bad = [];
  for (const rawPart of parts) {
    const d = rawPart.trim().toLowerCase().replace(/\.+$/, '');
    if (!d) continue;
    if (!DOMAIN_RE.test(d)) {
      bad.push(d);
      continue;
    }
    if (!domains.includes(d)) domains.push(d);
  }

  if (bad.length) {
    return {
      ok: false,
      error: `域名格式不对：「${bad.join('、')}」。域名只能用字母、数字、点、连字符（可用 *. 通配）。${HINT}`,
    };
  }
  if (!domains.length) {
    return { ok: false, error: `没解析出任何域名。${HINT}` };
  }

  const json = JSON.stringify(domains);
  // sed 替换文本的防注入自检
  if (/[\\&|\n\r]/.test(json)) {
    return { ok: false, error: `域名里含有无法安全渲染的字符。${HINT}` };
  }
  return { ok: true, domains, json };
}

// ── CLI ──────────────────────────────────────────────────────
const isCli =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isCli) {
  const input = process.argv[2] ?? process.env.DOMAIN ?? process.env.MAIL_DOMAINS ?? '';
  const r = normalizeDomains(input);
  if (!r.ok) {
    console.error(`✗ ${r.error}`);
    process.exit(1);
  }
  console.error(`✓ 域名：${r.domains.join(', ')}（${r.domains.length} 个）`);
  console.log(r.json);
}
