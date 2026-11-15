/**
 * 入站邮件的统一中间格式。
 *
 * 收信原来只有一条路：Cloudflare Email Routing → ForwardableEmailMessage。
 * 现在多了「域名没托管到 Cloudflare」的场景，走发信商的 inbound webhook
 * 或自建接口。各家的 payload 千差万别，先归一化成这一个结构，
 * 后面的归属匹配 / AI 垃圾侦测 / 入库 / 规则分发完全复用同一套代码。
 */
export interface InboundAttachment {
  filename: string;
  contentType: string;
  content: ArrayBuffer;
}

export interface InboundMail {
  from: string;
  fromName?: string;
  /** 所有收件人（含原样与 +tag 变体），归属匹配会逐个试 */
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  /** RFC 5322 Message-ID，用于去重（webhook 会重试） */
  messageId?: string;
  /** 服务商侧的事件 / 邮件 id，用于去重与日志 */
  eventId?: string;
  attachments?: InboundAttachment[];
  /** 原始邮件体积（字节） */
  size?: number;
  /** 来源：cloudflare / resend / postmark / sendgrid / mailgun / generic */
  source: string;
}

export type InboundSource = 'cloudflare' | 'resend' | 'postmark' | 'sendgrid' | 'mailgun' | 'generic';

export const INBOUND_SOURCES: InboundSource[] = [
  'cloudflare',
  'resend',
  'postmark',
  'sendgrid',
  'mailgun',
  'generic',
];

/** 从「Display Name <a@b.com>」里抠出纯地址 */
export function extractEmail(s: string | undefined | null): string {
  if (!s) return '';
  const m = /<([^>]+)>/.exec(s) ?? /([^\s<>,;]+@[^\s<>,;]+)/.exec(s);
  return (m?.[1] ?? m?.[0] ?? '').trim().toLowerCase();
}

/** 从「Display Name <a@b.com>」里抠出显示名 */
export function extractName(s: string | undefined | null): string {
  if (!s) return '';
  const m = /^([^<]*?)\s*</.exec(s);
  return (m?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
}

/** 把 +tag 去掉，Postmark 的 MailboxHash / 子地址寻址都靠这个 */
export function stripPlusTag(addr: string): string {
  const [local, domain] = addr.split('@');
  if (!domain) return addr;
  return `${local.split('+')[0]}@${domain}`;
}

/** 多个收件人字段（可能是字符串、数组、逗号串）统一成去重数组 */
export function toRecipients(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (Array.isArray(v)) {
      for (const item of v) out.push(...toRecipients(item));
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      out.push(extractEmail(String(o.Email ?? o.email ?? o.address ?? '')));
    } else if (typeof v === 'string') {
      for (const part of v.split(/[,;]/)) {
        const a = extractEmail(part);
        if (a) out.push(a);
      }
    }
  }
  return [...new Set(out.filter(Boolean))];
}
