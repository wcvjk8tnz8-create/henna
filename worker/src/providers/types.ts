export type ProviderKind =
  | 'resend'
  | 'sendgrid'
  | 'mailgun'
  | 'brevo'
  | 'postmark'
  | 'smtp'
  | 'cloudflare'
  | 'noop';

export interface Attachment {
  filename: string;
  /** base64 编码内容 */
  content: string;
  contentType?: string;
}

export interface OutgoingMail {
  /** 支持 "Name <a@b.com>" 或纯地址 */
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Attachment[];
}

export interface SendResult {
  success: boolean;
  /** 服务商返回的消息 ID */
  id?: string;
  provider: ProviderKind;
  error?: string;
}

export interface ProviderConfig {
  apiKey?: string;
  /** mailgun / brevo 等需要额外区域或域名参数 */
  region?: string;
  domain?: string;
  /** SMTP-over-HTTP 中继端点 */
  endpoint?: string;
  username?: string;
  password?: string;
  host?: string;
  port?: string;
  /** Cloudflare Email Service 账户 ID（无 binding 时走 REST） */
  accountId?: string;
  defaultFrom?: string;
  [k: string]: string | undefined;
}

export interface ProviderField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'select';
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  hint?: string;
}

export interface MailProvider {
  kind: ProviderKind;
  label: string;
  docs: string;
  fields: ProviderField[];
  send(mail: OutgoingMail, cfg: ProviderConfig, env: import('../env').Env): Promise<SendResult>;
}

/** "Alice <alice@x.com>" → { name, email } */
export function parseAddress(raw: string): { name?: string; email: string } {
  const m = /^\s*(?:"?([^"<]*?)"?\s*)?(?:<([^>]+)>|([^\s<>]+@[^\s<>]+))\s*$/.exec(raw ?? '');
  if (!m) return { email: (raw ?? '').trim() };
  const email = (m[2] || m[3] || '').trim();
  const name = (m[1] || '').trim();
  return name ? { name, email } : { email };
}

export function firstTo(mail: OutgoingMail): string {
  return mail.to?.[0] ?? '';
}
