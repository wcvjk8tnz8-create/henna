/**
 * 垃圾邮件侦测 · Workers AI
 *
 * 设计原则：**AI 挂了不能影响收信**。
 * 分类是收信链路上的旁路 —— 绑定缺失、模型报错、超时、返回畸形 JSON，
 * 一律回退到启发式打分，邮件照常入库。
 *
 * 两条调用路径：
 *   1. 原生 AI binding（wrangler `[ai] binding = "AI"`）—— 首选，不需要 token
 *   2. Cloudflare REST API —— 没绑定时的兜底，用 ai_account_id / ai_api_token
 * 两条都不通 → 启发式规则，保证功能「真的能用」而不是只写个开关。
 */
import type { Env } from '../env';
import type { SettingsMap } from '../db/settings';
import { isTrue } from '../db/settings';

export interface SpamInput {
  from: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SpamVerdict {
  spam: boolean;
  /** 0~1，越大越像垃圾 */
  score: number;
  reason: string;
  /** ai = 模型判定 / heuristic = 规则兜底 / off = 未启用 */
  source: 'ai' | 'heuristic' | 'off';
  /** 实际用的模型（便于排查） */
  model?: string;
}

export const DEFAULT_SPAM_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const SYSTEM_PROMPT = `You are an email spam classifier. Reply with ONLY a JSON object, no markdown, no extra text.
Schema: {"spam":boolean,"score":number,"reason":string}
score is 0.0-1.0 (higher = more likely spam). reason is a short Chinese phrase under 20 characters.
Judge by: unsolicited bulk mail, phishing / credential requests, fake prizes, crypto or loan scams,
deceptive links, urgent money requests, mass marketing. Legitimate transactional mail
(verification codes, receipts, course notices, CI alerts, personal replies) is NOT spam.`;

/** 构造 prompt 输入。正文截断，避免长信把 token 打爆 */
export function buildSpamMessages(mail: SpamInput, maxChars = 1200): Record<string, unknown> {
  const body = (mail.text || stripHtml(mail.html ?? '') || '').slice(0, maxChars);
  const user = [
    `From: ${mail.from || '(unknown)'}`,
    `Subject: ${mail.subject || '(no subject)'}`,
    `Body: ${body || '(empty)'}`,
  ].join('\n');
  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    max_tokens: 120,
    temperature: 0,
  };
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析模型输出。
 * 模型经常不听话：包 ```json 代码块、前后带解释、返回 true/false 字符串、
 * score 写成 "0.9" 甚至中文数字 —— 这里全部兼容，解析不出来就返回 null
 * （调用方会回退到启发式，绝不抛异常）。
 */
export function parseSpamVerdict(raw: unknown): { spam: boolean; score: number; reason: string } | null {
  let text = '';
  if (typeof raw === 'string') text = raw;
  else if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (typeof o.response === 'string') text = o.response;
    else if (o.response && typeof o.response === 'object') text = JSON.stringify(o.response);
    else text = JSON.stringify(o);
  }
  if (!text) return null;

  // 去掉 markdown 代码块
  text = text.replace(/```(?:json)?/gi, '').trim();

  // 优先抠出第一个 JSON 对象
  let obj: Record<string, unknown> | null = null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      obj = null;
      // 模型明显想输出 JSON（以 { 开头）却写坏了 —— 别把它当自由文本猜，
      // 直接交给启发式，避免 "spam" 这个词本身被误当成判定结果。
      if (text.trimStart().startsWith('{')) return null;
    }
  } else if (start >= 0 && text.trimStart().startsWith('{')) {
    // 有 { 却没有 } —— JSON 被截断了，同样别当自由文本猜
    return null;
  }

  let spam: boolean;
  let score: number;
  let reason = '';

  if (obj && ('spam' in obj || 'is_spam' in obj || 'label' in obj)) {
    const rawSpam = obj.spam ?? obj.is_spam ?? obj.label;
    spam = toBool(rawSpam);
    const rawScore = obj.score ?? obj.confidence ?? obj.probability;
    score = toScore(rawScore, spam);
    reason = String(obj.reason ?? obj.explanation ?? '').slice(0, 80);
  } else {
    // 兜底：模型只回了 "SPAM" / "NOT SPAM" / "true" 之类的纯文本
    const low = text.toLowerCase();
    const looksSpam = /\bspam\b|\bjunk\b|垃圾|詐騙|诈骗|釣魚|钓鱼/.test(low);
    const looksHam = /\bham\b|\bnot spam\b|\blegit\b|正常|非垃圾/.test(low);
    if (!looksSpam && !looksHam) return null;
    spam = looksSpam && !looksHam;
    score = spam ? 0.85 : 0.1;
    reason = '模型文本判定';
  }

  return { spam, score, reason: reason || (spam ? '疑似垃圾邮件' : '正常邮件') };
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v >= 0.5;
  const s = String(v ?? '').toLowerCase().trim();
  return ['true', '1', 'yes', 'spam', 'junk', '垃圾', 'phishing', 'malicious'].includes(s);
}

function toScore(v: unknown, spam: boolean): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n)) return spam ? 0.85 : 0.1;
  // 模型有时给 0~100
  const s = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, s));
}

/* ── 启发式兜底 ─────────────────────────────────────── */

const SPAM_WORDS = [
  'congratulations', 'you have won', 'claim your prize', 'free gift', 'lottery',
  'urgent', 'verify your account', 'update your payment', 'suspended account',
  'click here', 'limited time', 'act now', 'no obligation', '100% free',
  'make money fast', 'work from home', 'crypto investment', 'guaranteed return',
  'loan approved', 'inheritance', 'wire transfer', 'gift card',
  '中獎', '中奬', '領取獎金', '恭喜您', '免費領取', '限時', '立即點擊',
  '帳號將被停用', '驗證您的帳戶', '投資獲利', '保證獲利', '貸款核准',
];

const HAM_WORDS = [
  'verification code', 'verify code', 'one-time', 'otp', 'receipt', 'invoice',
  'order confirmed', 'password reset', 'github', 'cloudflare', 'deploy',
  'course', 'lecture', 'assignment', 'meeting', 'readme', 'pull request',
  '驗證碼', '驗證信', '收據', '訂單', '課程', '作業', '會議', '部署',
];

/**
 * 规则打分。不是要取代 AI，而是 AI 不可用时仍能给出可用结果。
 * 命中垃圾词 +0.18、正常词 -0.22，再叠加几个结构性信号。
 */
export function heuristicSpamScore(mail: SpamInput): { score: number; reason: string } {
  const text = `${mail.subject} ${mail.text || stripHtml(mail.html ?? '')}`.toLowerCase();
  let score = 0.08;
  const hits: string[] = [];

  for (const w of SPAM_WORDS) {
    if (text.includes(w)) {
      score += 0.18;
      hits.push(w);
    }
  }
  for (const w of HAM_WORDS) {
    if (text.includes(w)) score -= 0.22;
  }

  // 大量链接
  const urls = (mail.html ?? mail.text ?? '').match(/https?:\/\//gi)?.length ?? 0;
  if (urls >= 5) {
    score += 0.28;
    hits.push(`${urls} 个链接`);
  }
  // 主题全大写 + 感叹号
  const subj = mail.subject || '';
  if (subj.length > 8 && subj === subj.toUpperCase() && /[A-Z]{6}/.test(subj)) {
    score += 0.12;
    hits.push('全大写主题');
  }
  if ((subj.match(/!/g)?.length ?? 0) >= 3) {
    score += 0.1;
    hits.push('多个感叹号');
  }
  // 发件人可疑
  if (/noreply|no-reply|promo|marketing|deals|offer|winner/i.test(mail.from)) {
    score += 0.1;
    hits.push('营销型发件人');
  }
  // 正文极短但满是链接
  if (text.length < 60 && urls >= 2) {
    score += 0.15;
    hits.push('短正文+链接');
  }

  score = Math.min(1, Math.max(0, score));
  return {
    score: Math.round(score * 100) / 100,
    reason: hits.length ? `规则命中：${hits.slice(0, 2).join('、')}` : '未命中垃圾特征',
  };
}

/* ── AI 调用 ────────────────────────────────────────── */

/** 最小 AI binding 接口，不依赖 workers-types 版本 */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

function aiConfig(s: SettingsMap, env: Env): { model: string; account: string; token: string; maxChars: number; threshold: number } {
  return {
    model: s.spam_model || s.ai_model || DEFAULT_SPAM_MODEL,
    account: s.ai_account_id || env.CF_ACCOUNT_ID || '',
    token: s.ai_api_token || env.CF_API_TOKEN || '',
    maxChars: Math.min(4000, Math.max(200, Number(s.spam_max_chars || 1200) || 1200)),
    threshold: Math.min(1, Math.max(0, Number(s.spam_threshold || 0.7) || 0.7)),
  };
}

/** 走原生 binding，5 秒超时 */
async function runBinding(env: Env, model: string, input: Record<string, unknown>): Promise<unknown> {
  const ai = (env as Env & { AI?: AiBinding }).AI;
  if (!ai || typeof ai.run !== 'function') throw new Error('AI binding 未配置');
  return await Promise.race([
    ai.run(model, input),
    new Promise((_, rej) => setTimeout(() => rej(new Error('AI 超时')), 5000)),
  ]);
}

/** 走 Cloudflare REST（没绑定时的兜底） */
async function runRest(
  account: string,
  token: string,
  model: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!account || !token) throw new Error('REST 兜底缺 account/token');
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`REST ${r.status}`);
  const j = (await r.json()) as { result?: unknown };
  return j.result ?? j;
}

/**
 * 主入口。永远返回结果，永远不抛异常。
 *
 * 阈值逻辑：AI 给的 score 用站点阈值裁决，而不是只信模型自己的 spam 布尔 ——
 * 有些模型会把「促销但合法」判成 true 却只给 0.55，阈值能压住误杀。
 */
export async function classifySpam(env: Env, mail: SpamInput, s: SettingsMap): Promise<SpamVerdict> {
  if (!isTrue(s.spam_enabled)) {
    return { spam: false, score: 0, reason: '未启用', source: 'off' };
  }

  const cfg = aiConfig(s, env);
  const input = buildSpamMessages(mail, cfg.maxChars);

  try {
    let raw: unknown;
    try {
      raw = await runBinding(env, cfg.model, input);
    } catch {
      raw = await runRest(cfg.account, cfg.token, cfg.model, input);
    }
    const parsed = parseSpamVerdict(raw);
    if (parsed) {
      return {
        spam: parsed.score >= cfg.threshold,
        score: parsed.score,
        reason: parsed.reason,
        source: 'ai',
        model: cfg.model,
      };
    }
  } catch {
    /* 落到启发式 */
  }

  const h = heuristicSpamScore(mail);
  return {
    spam: h.score >= cfg.threshold,
    score: h.score,
    reason: h.reason,
    source: 'heuristic',
    model: cfg.model,
  };
}

/** 侦测是否可用（给设置页的状态卡片用） */
export function aiAvailability(env: Env, s: SettingsMap): { binding: boolean; rest: boolean; mode: string; model: string } {
  const binding = typeof (env as Env & { AI?: AiBinding }).AI?.run === 'function';
  const cfg = aiConfig(s, env);
  const rest = !!(cfg.account && cfg.token);
  return {
    binding,
    rest,
    mode: binding ? 'Workers AI 绑定' : rest ? 'REST API 兜底' : '启发式规则',
    model: cfg.model,
  };
}
