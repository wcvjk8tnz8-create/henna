import type { SessionUser } from '../env';

/**
 * 解析托管域名列表，永不抛异常。
 *
 * 关键：MAIL_DOMAINS 在 wrangler 配置里可能是两种形态——
 *   - JSON/TOML 数组  `["a.com"]`  → 运行时是真正的 JS 数组
 *   - 字符串          '"[\"a.com\"]"' 或 'a.com,b.com'
 * 早期版本只按字符串处理，TOML 数组传进来后 JSON.parse(数组) 会抛
 * SyntaxError，进而让 /api/system/config 直接 500 —— 就是那个
 * 满屏 "internal error" 的来源。这里三种形态全兼容。
 */
export function parseDomains(env: { MAIL_DOMAINS?: string | string[] | unknown }): string[] {
  const raw: unknown = env?.MAIL_DOMAINS;

  // 形态一：已经是数组（TOML/JSON 数组）
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }

  // 形态二：字符串
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      const arr = JSON.parse(s) as unknown;
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* 不是 JSON，走逗号分隔 */
    }
    return s
      .replace(/^\[|\]$/g, '')
      .replace(/["']/g, '')
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return [];
}

export function now(): number {
  return Date.now();
}

export function requireAddressOwner(owner: string | undefined, user: SessionUser): void {
  if (user.role === 'admin') return;
  if (!owner || owner !== user.email) throw new Error('无权访问该地址');
}

/** 收件人白名单以外的域名不做限制，但要求发件域名在系统托管的域名内 */
export function assertFromAllowed(from: string, domains: string[]): void {
  const email = /<([^>]+)>|([^\s<>]+@[^\s<>]+)/.exec(from)?.[1] ?? from;
  const domain = email.split('@')[1] ?? '';
  if (domains.length > 0 && !domains.includes(domain)) {
    throw new Error(`发件域名 ${domain} 不在托管域名列表内`);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
