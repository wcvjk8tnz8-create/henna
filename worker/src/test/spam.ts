/**
 * Workers AI 垃圾邮件侦测回归测试
 *
 * 重点锁死两件事：
 * 1. 模型输出千奇百怪（markdown 代码块、前后带解释、纯文本 SPAM、
 *    score 给 0~100、response 包一层），解析必须全吃得下且**永不抛异常**；
 * 2. AI 不可用（没绑定 / 报错 / 超时）时必须退到启发式规则，
 *    收信链路不能被侦测拖垮。
 */

export {};

import {
  buildSpamMessages,
  parseSpamVerdict,
  heuristicSpamScore,
  classifySpam,
  aiAvailability,
  stripHtml,
  DEFAULT_SPAM_MODEL,
  type SpamInput,
} from '../lib/spam';
import { DEFAULT_SETTINGS } from '../db/settings';
import type { Env } from '../env';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
  }
}

function env(extra: Record<string, unknown> = {}): Env {
  return { ...extra } as unknown as Env;
}

function settings(patch: Record<string, string> = {}) {
  return { ...DEFAULT_SETTINGS, spam_enabled: 'true', ...patch };
}

const SPAM_MAIL: SpamInput = {
  from: 'winner@promo-deals.example',
  subject: 'Congratulations! You have WON a FREE gift!!! Act now',
  text: 'Limited time offer, claim your prize. 100% free, guaranteed return. Click here now!',
};

const HAM_MAIL: SpamInput = {
  from: 'noreply@github.com',
  subject: 'Your verification code',
  text: 'Your one-time verification code is 482913. This code expires in 10 minutes.',
};

console.log('模型输出解析：');

const cases: Array<[string, unknown, boolean, number]> = [
  ['标准 JSON', '{"spam":true,"score":0.93,"reason":"钓鱼链接"}', true, 0.93],
  ['markdown 代码块', '```json\n{"spam":true,"score":0.88,"reason":"诈骗"}\n```', true, 0.88],
  ['前后带解释', 'Here is my analysis:\n{"spam": false, "score": 0.12, "reason":"正常通知"}\nHope it helps.', false, 0.12],
  ['response 包一层', { response: '{"spam":true,"score":0.77,"reason":"促销"}' }, true, 0.77],
  ['response 是对象', { response: { spam: true, score: 0.8, reason: 'x' } }, true, 0.8],
  ['score 给 0~100', '{"spam":true,"score":91,"reason":"垃圾"}', true, 0.91],
  ['score 是字符串', '{"spam":true,"score":"0.9","reason":"垃圾"}', true, 0.9],
  ['label 字段', '{"label":"spam","score":0.8,"reason":"x"}', true, 0.8],
  ['is_spam 字段', '{"is_spam":"yes","confidence":0.75}', true, 0.75],
  ['纯文本 SPAM', 'SPAM', true, 0.85],
  ['纯文本 NOT SPAM', 'This is NOT SPAM, it is legitimate', false, 0.1],
];
for (const [name, raw, spam, score] of cases) {
  const v = parseSpamVerdict(raw);
  check(
    `${name} → ${spam ? '垃圾' : '正常'} ${Math.round(score * 100)}%`,
    !!v && v.spam === spam && Math.abs(v.score - score) < 0.02,
  );
}

check('完全无法解析 → 返回 null（调用方会回退）', parseSpamVerdict('hello world') === null);
check('坏 JSON → 返回 null 不抛异常', parseSpamVerdict('{spam: true, oops') === null);
check('null → 返回 null', parseSpamVerdict(null) === null);
check('undefined → 返回 null', parseSpamVerdict(undefined) === null);
check('空对象 → 返回 null', parseSpamVerdict({}) === null);

console.log('');
console.log('启发式规则：');

const spamH = heuristicSpamScore(SPAM_MAIL);
const hamH = heuristicSpamScore(HAM_MAIL);
check(`明显垃圾得分高 (${spamH.score})`, spamH.score >= 0.7);
check(`验证码邮件得分低 (${hamH.score})`, hamH.score < 0.3);
check('垃圾得分 > 正常得分', spamH.score > hamH.score);
check('得分落在 0~1', spamH.score >= 0 && spamH.score <= 1 && hamH.score >= 0 && hamH.score <= 1);
check('给出可读原因', spamH.reason.length > 0);
check(
  '大量链接加权',
  heuristicSpamScore({ from: 'a@b.com', subject: 'hi', text: 'https://a.com https://b.com https://c.com https://d.com https://e.com' }).score > 0.3,
);
check('HTML 正文也能识别', heuristicSpamScore({ from: 'a@b.com', subject: 'x', text: '', html: '<p>Congratulations you have won a free gift</p>' }).score >= 0.25);

console.log('');
console.log('HTML 清洗：');
check('去标签', stripHtml('<p>Hello <b>world</b></p>') === 'Hello world');
check('去 script/style', !stripHtml('<style>x</style><script>bad()</script>ok').includes('bad'));

console.log('');
console.log('prompt 构造：');
const msgs = buildSpamMessages({ ...SPAM_MAIL, text: 'x'.repeat(5000) }, 1200) as {
  messages: { role: string; content: string }[];
};
check('正文按上限截断', (msgs.messages[1]?.content ?? '').length < 1500);
check('含 system + user 两条消息', msgs.messages.length === 2 && msgs.messages[0].role === 'system');
check('带上 From / Subject / Body', ['From:', 'Subject:', 'Body:'].every((k) => (msgs.messages[1]?.content ?? '').includes(k)));

console.log('');
console.log('classifySpam 主流程：');

const off = await classifySpam(env(), SPAM_MAIL, settings({ spam_enabled: 'false' }));
check('未启用 → source=off 且不判垃圾', off.source === 'off' && !off.spam);

const noAi = await classifySpam(env(), SPAM_MAIL, settings());
check('无绑定无 token → 退到启发式', noAi.source === 'heuristic');
check('退到启发式仍能判出垃圾', noAi.spam === true);

const fakeAi = env({ AI: { run: async () => ({ response: '{"spam":true,"score":0.95,"reason":"钓鱼"}' }) } });
const withAi = await classifySpam(fakeAi, SPAM_MAIL, settings());
check('有绑定 → source=ai', withAi.source === 'ai');
check('AI 判定为垃圾', withAi.spam === true);
check('记录用到的模型', withAi.model === DEFAULT_SPAM_MODEL);

const brokenAi = env({ AI: { run: async () => { throw new Error('model unavailable'); } } });
const fallback = await classifySpam(brokenAi, SPAM_MAIL, settings());
check('AI 抛错 → 退到启发式不抛异常', fallback.source === 'heuristic');

const garbageAi = env({ AI: { run: async () => 'I am not sure what to say' } });
const garbage = await classifySpam(garbageAi, SPAM_MAIL, settings());
check('AI 返回无法解析 → 退到启发式', garbage.source === 'heuristic');

const lowScore = await classifySpam(
  env({ AI: { run: async () => ({ response: '{"spam":true,"score":0.55,"reason":"促销"}' }) } }),
  SPAM_MAIL,
  settings({ spam_threshold: '0.7' }),
);
check('低于阈值不判垃圾（防误杀）', lowScore.spam === false);
const highScore = await classifySpam(
  env({ AI: { run: async () => ({ response: '{"spam":false,"score":0.92,"reason":"漏判"}' }) } }),
  SPAM_MAIL,
  settings({ spam_threshold: '0.7' }),
);
check('高分即使模型说 false 也判垃圾', highScore.spam === true);

console.log('');
console.log('可用性检测：');
check('无绑定 → 启发式模式', aiAvailability(env(), settings()).mode === '启发式规则');
check('有绑定 → Workers AI 绑定', aiAvailability(fakeAi, settings()).binding === true);
check('无绑定但有 REST 凭据 → REST 兜底', aiAvailability(env(), settings({ ai_account_id: 'acc', ai_api_token: 'tok' })).mode === 'REST API 兜底');

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} 项失败`);
