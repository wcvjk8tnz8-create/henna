/** 极简 API 客户端：统一携带 JWT，统一解 ok/data 信封 */
const TOKEN_KEY = 'henna.token';

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? '';
}
export function setToken(t: string): void {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api${path}`, { ...init, headers });
  const json = (await res.json().catch(() => ({}))) as {
    ok: boolean;
    data?: T;
    error?: string;
  };
  if (!res.ok || json.ok === false) {
    throw new ApiError(json.error ?? `请求失败 (${res.status})`, res.status);
  }
  return json.data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};

/* ── 类型 ───────────────────────────────────────────── */
export interface Me {
  id: number;
  email: string;
  role: 'admin' | 'user';
  quota: number;
  used: number;
  api_key: string | null;
  /** 注册时间。老数据可能为 null（/me 之前不返回这个字段） */
  created_at?: number | null;
}
export interface PublicConfig {
  appName: string;
  domains: string[];
  allowRegister: boolean;
  strategy: string;
  /** 存储未启用时为 false，附件功能降级 */
  attachments: boolean;
  storage?: string;
  /** 登录页需要的公开设置 */
  settings?: Record<string, string>;
}
export interface MailItem {
  id: number;
  direction: string;
  from_addr: string;
  from_name: string;
  to_addr: string;
  subject: string;
  is_read: number;
  is_star: number;
  size: number;
  created_at: number;
  /** 仅 scope=all（管理员）时返回，标明这封邮件属于谁 */
  owner?: string;
}
export interface MailDetail extends MailItem {
  text_body: string | null;
  html_body: string | null;
  attachments: { id: number; name: string; mime: string; size: number }[];
}
export interface Address {
  id: number;
  user_id: number;
  address: string;
  domain: string;
  enabled: number;
  created_at: number;
  owner?: string;
}
export interface ProviderItem {
  id: number;
  name: string;
  kind: string;
  label: string;
  enabled: number;
  weight: number;
  daily_used: number;
  last_error: string | null;
  config: Record<string, string>;
}
export interface ProviderMeta {
  kind: string;
  label: string;
  docs: string;
  fields: {
    key: string;
    label: string;
    type: 'text' | 'password' | 'select';
    required?: boolean;
    placeholder?: string;
    options?: { label: string; value: string }[];
    hint?: string;
  }[];
}
export interface RuleItem {
  id: number;
  user_id: number;
  name: string;
  match_address: string;
  match_from: string;
  match_subject: string;
  action: string;
  target: string;
  enabled: number;
  created_at: number;
}
export interface LogItem {
  id: number;
  provider: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  status: string;
  error: string | null;
  created_at: number;
}
export interface Stats {
  users: number;
  inbox: number;
  outbox: number;
  providers: number;
  addresses: number;
  failed: number;
  trend: { d: string; n: number }[];
  byProvider: { provider: string; n: number }[];
  totalLogs: number;
  okLogs: number;
  today: number;
  topDomains: { domain: string; n: number }[];
  topAddresses: { address: string; n: number }[];
}
export interface AdminUser {
  id: number;
  email: string;
  role: string;
  quota: number;
  used: number;
  status: string;
  created_at: number;
}
export interface Invite {
  id: number;
  code: string;
  role: string;
  quota: number;
  max_use: number;
  used: number;
  expire_at: number | null;
}

export type SettingsMap = Record<string, string>;

export interface StorageStatus {
  configured: string;
  effective: string;
  r2Bound: boolean;
  publicDomain: string;
  sampleUrl: string | null;
  hint: string;
}
