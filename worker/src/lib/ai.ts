/**
 * Workers AI 验证码识别。
 *
 * 走 REST 而非 binding —— binding 需要在 wrangler 里声明 `ai`，
 * 部分账户未开通会导致部署失败。REST 方式零部署风险，且账号信息
 * 可在后台配置。
 *
 * 未配置时接口返回明确的「未启用」，不会 500。
 */

export interface AiConfig {
  enabled: boolean;
  model: string;
  accountId: string;
  apiToken: string;
}

const PROMPT =
  '图片中是一个验证码。只输出你看到的验证码字符（数字或字母），不要任何解释、不要标点、不要空格。若看不清，输出 UNKNOWN。';

/**
 * 识别验证码。imageBase64 为纯 base64（不含 data: 前缀）。
 * 返回识别出的文本；失败时抛错，由路由层转成人话。
 */
export async function recognizeCaptcha(cfg: AiConfig, imageBase64: string): Promise<string> {
  if (!cfg.enabled) throw new Error('Workers AI 未启用');
  if (!cfg.accountId || !cfg.apiToken) throw new Error('未配置 AI 账号 ID 或 API Token');

  const clean = imageBase64.includes(',') ? imageBase64.split(',').pop()! : imageBase64;
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/run/${encodeURI(cfg.model)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: clean,
      prompt: PROMPT,
      max_tokens: 64,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    result?: { description?: string; response?: string };
    errors?: Array<{ message?: string }>;
  };

  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => e.message).join('; ');
    throw new Error(`AI 调用失败：${msg || res.status}`);
  }

  const text = String(
    json.result?.description ?? json.result?.response ?? '',
  )
    .replace(/[^0-9a-zA-Z]/g, '')
    .trim();
  return text || 'UNKNOWN';
}
