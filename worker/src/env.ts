/**
 * Cloudflare Workers bindings & runtime vars.
 * 所有 binding 名必须和 wrangler.jsonc 严格一致 —— 这就是用 TS 的理由之一。
 */
export interface Env {
  /** D1 关系库：用户 / 地址 / 邮件 / 服务商 / 规则 / 日志 */
  DB: D1Database;
  /** KV：会话黑名单、限流计数、设置缓存 */
  KV: KVNamespace;
  /** R2：附件存储（可选，未启用时附件功能自动降级） */
  R2?: R2Bucket;
  /** 前端静态资源 */
  ASSETS: Fetcher;

  /** 可选：Cloudflare Email Service 原生发信 binding（需开通） */
  SEND_EMAIL?: SendEmailBinding;

  APP_NAME: string;
  JWT_SECRET: string;
  ADMIN_EMAIL: string;
  /** JSON 字符串数组，例如 ["a.com","b.com"] */
  MAIL_DOMAINS: string;
  ALLOW_REGISTER: string;
  /** 每用户每日发信配额 */
  DEFAULT_QUOTA: string;
  /** priority | round_robin */
  PROVIDER_STRATEGY: string;

  /** 可选：Cloudflare REST 发信（无 binding 时走 REST） */
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

export interface SendEmailBinding {
  send(message: {
    to: { email: string; name?: string } | Array<{ email: string; name?: string }>;
    from: { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
  }): Promise<unknown>;
}

export type Role = 'admin' | 'user';

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  quota: number;
  used: number;
}
