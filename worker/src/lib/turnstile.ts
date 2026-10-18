/**
 * Cloudflare Turnstile 人机验证服务端校验。
 * 未配置 secret 或开关关闭时直接放行（不阻断登录）。
 */
import { isTrue } from '../db/settings';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  ok: boolean;
  error?: string;
}

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp: string | undefined,
  cfg: { enabled: string; secretKey: string },
): Promise<TurnstileResult> {
  if (!isTrue(cfg.enabled)) return { ok: true };
  if (!cfg.secretKey) {
    // 开了开关却没填密钥 —— 放行但记录，避免把自己锁在门外
    return { ok: true, error: 'turnstile_secret_key 未配置，已跳过校验' };
  }
  if (!token) return { ok: false, error: '请完成人机验证' };

  const form = new FormData();
  form.set('secret', cfg.secretKey);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: 'POST', body: form });
    const json = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (json.success) return { ok: true };
    return { ok: false, error: `人机验证失败：${(json['error-codes'] ?? []).join(', ')}` };
  } catch (e) {
    // 网络异常时放行，避免 Cloudflare 抖动导致全站无法登录
    return { ok: true, error: `turnstile 校验异常（已放行）：${String(e)}` };
  }
}
