import type { SessionUser } from '../env';

export function parseDomains(env: { MAIL_DOMAINS: string }): string[] {
  try {
    const arr = JSON.parse(env.MAIL_DOMAINS || '[]') as unknown;
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return (env.MAIL_DOMAINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
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
