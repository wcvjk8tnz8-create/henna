/**
 * 站点设置：D1 里的一张 key-value 表，带默认值与敏感字段掩码。
 *
 * 约定：
 * - 敏感字段（各种 secret）读取时只返回掩码 `****abcd`；
 * - 写入时若值以 `****` 开头，视为「未修改」，直接跳过 —— 前端回显掩码
 *   再提交不会把掩码写进数据库。
 */
import type { D1Database } from '@cloudflare/workers-types/experimental';
import { qAll, exec } from './query';

/** 敏感字段：永不以明文返回给前端 */
export const SECRET_KEYS = [
  'turnstile_secret_key',
  'oauth_github_secret',
  'oauth_google_secret',
  'oauth_linuxdo_secret',
  'telegram_bot_token',
  's3_secret_key',
  'ai_api_token',
] as const;

/** 公开字段：未登录也能读（登录页要用） */
export const PUBLIC_KEYS = [
  'site_title',
  'site_notice_enabled',
  'site_notice_content',
  'login_bg',
  'login_opacity',
  'hide_login_domain',
  'allow_register',
  'turnstile_enabled',
  'turnstile_login',
  'turnstile_register',
  'turnstile_site_key',
  'oauth_github_enabled',
  'oauth_google_enabled',
  'oauth_linuxdo_enabled',
] as const;

export const DEFAULT_SETTINGS: Record<string, string> = {
  // ── 基本
  site_title: 'Henna Mail',
  site_notice_enabled: 'false',
  site_notice_content: '',
  allow_register: 'true',
  require_invite: 'false',
  multi_address: 'true',
  multi_address_limit: '5',
  hide_login_domain: 'false',
  // ── 个性化
  login_bg: '',
  login_opacity: '0.92',
  // ── 人机验证
  turnstile_enabled: 'false',
  turnstile_login: 'true',
  turnstile_register: 'true',
  turnstile_site_key: '',
  turnstile_secret_key: '',
  // ── 第三方登录
  oauth_github_enabled: 'false',
  oauth_github_client_id: '',
  oauth_github_secret: '',
  oauth_google_enabled: 'false',
  oauth_google_client_id: '',
  oauth_google_secret: '',
  oauth_linuxdo_enabled: 'false',
  oauth_linuxdo_client_id: '',
  oauth_linuxdo_secret: '',
  // ── 消息推送（全局默认，用户级规则优先）
  push_telegram_enabled: 'false',
  telegram_bot_token: '',
  telegram_chat_id: '',
  push_webhook_enabled: 'false',
  webhook_url: '',
  push_forward_enabled: 'false',
  forward_email: '',
  forward_mode: 'rule', // all = 全部转发 / rule = 仅按规则
  // ── 对象存储
  storage_type: 'r2', // r2 | s3 | none
  storage_public_domain: '',
  s3_endpoint: '',
  s3_region: 'auto',
  s3_bucket: '',
  s3_access_key: '',
  s3_secret_key: '',
  // ── Workers AI
  ai_enabled: 'false',
  ai_model: '@cf/llava-hf/llava-1.5-7b-hf',
  ai_account_id: '',
  ai_api_token: '',
};

export type SettingsMap = Record<string, string>;

interface SettingRow {
  key: string;
  value: string;
}

/** 读取全部设置（含默认值兜底） */
export async function getAllSettings(db: D1Database): Promise<SettingsMap> {
  const out: SettingsMap = { ...DEFAULT_SETTINGS };
  try {
    const rows = await qAll<SettingRow>(db, 'SELECT key, value FROM setting');
    for (const r of rows) out[r.key] = r.value;
  } catch {
    /* 表还没建好时用默认值 */
  }
  return out;
}

/** 读取单个设置 */
export async function getSetting(db: D1Database, key: string): Promise<string> {
  const row = await qOne<SettingRow>(db, 'SELECT value FROM setting WHERE key = ?', key).catch(
    () => null,
  );
  return row?.value ?? DEFAULT_SETTINGS[key] ?? '';
}

async function qOne<T>(db: D1Database, sql: string, ...args: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...args).first()) as T | null;
}

/** 批量写入。返回实际写入的键数量 */
export async function setSettings(db: D1Database, patch: SettingsMap): Promise<number> {
  let n = 0;
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    // 掩码回显 → 视为未修改
    if (SECRET_KEYS.includes(k as (typeof SECRET_KEYS)[number]) && String(v).startsWith('****')) {
      continue;
    }
    await exec(
      db,
      'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      k,
      String(v),
    );
    n++;
  }
  return n;
}

/** 敏感字段掩码：保留末 4 位，便于确认改的是哪一个 */
export function maskSecret(v: string): string {
  if (!v) return '';
  const tail = v.slice(-4);
  return `****${tail}`;
}

/** 公开视图：只保留 PUBLIC_KEYS，且其中 secret 已掩码 */
export function toPublic(all: SettingsMap): SettingsMap {
  const out: SettingsMap = {};
  for (const k of PUBLIC_KEYS) {
    const v = all[k] ?? '';
    out[k] = SECRET_KEYS.includes(k as (typeof SECRET_KEYS)[number]) ? maskSecret(v) : v;
  }
  return out;
}

/** 管理员视图：全量，但 secret 掩码 */
export function toAdmin(all: SettingsMap): SettingsMap {
  const out: SettingsMap = {};
  for (const [k, v] of Object.entries(all)) {
    out[k] = SECRET_KEYS.includes(k as (typeof SECRET_KEYS)[number]) ? maskSecret(v) : v;
  }
  return out;
}

/** 取原始明文（仅后端内部使用，如调 Turnstile / OAuth） */
export async function getSecret(db: D1Database, key: string): Promise<string> {
  return getSetting(db, key);
}

export function isTrue(v: string | undefined): boolean {
  return v === 'true' || v === '1';
}
