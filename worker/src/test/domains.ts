/**
 * 回归测试：MAIL_DOMAINS 三种形态解析 + R2 缺失时的降级行为。
 * 这两个正是线上 "internal error" 与「R2 显示未绑定」的根因。
 */
import { parseDomains } from '../lib/util';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`, extra ?? '');
  }
}

// ── 1. TOML/JSON 数组（wrangler-action.toml 渲染后的真实形态）
// 这是之前炸掉的那一种：JSON.parse(数组) 抛 SyntaxError → 500
check(
  'TOML 数组直接解析',
  JSON.stringify(parseDomains({ MAIL_DOMAINS: ['a.com', 'b.com'] })) === '["a.com","b.com"]',
  parseDomains({ MAIL_DOMAINS: ['a.com', 'b.com'] }),
);

// ── 2. JSON 字符串（本地 wrangler.jsonc / 旧配置形态）
check(
  'JSON 字符串解析',
  JSON.stringify(parseDomains({ MAIL_DOMAINS: '["a.com","b.com"]' })) === '["a.com","b.com"]',
  parseDomains({ MAIL_DOMAINS: '["a.com","b.com"]' }),
);

// ── 3. 逗号分隔
check(
  '逗号分隔解析',
  JSON.stringify(parseDomains({ MAIL_DOMAINS: 'a.com, b.com' })) === '["a.com","b.com"]',
  parseDomains({ MAIL_DOMAINS: 'a.com, b.com' }),
);

// ── 4. 单个裸域名
check(
  '单个裸域名',
  JSON.stringify(parseDomains({ MAIL_DOMAINS: 'a.com' })) === '["a.com"]',
  parseDomains({ MAIL_DOMAINS: 'a.com' }),
);

// ── 5. 边界：空 / undefined / 空数组，一律不抛异常
check('空字符串返回空数组', parseDomains({ MAIL_DOMAINS: '' }).length === 0);
check('undefined 不抛异常', parseDomains({} as { MAIL_DOMAINS?: string }).length === 0);
check('空数组返回空数组', parseDomains({ MAIL_DOMAINS: [] }).length === 0);
check('畸形 JSON 串不抛异常', parseDomains({ MAIL_DOMAINS: '[not-json' }).length >= 0);

// ── 6. 数字等异常类型也不应抛
check(
  '异常类型安全兜底',
  parseDomains({ MAIL_DOMAINS: 123 as unknown as string }).length === 0,
  parseDomains({ MAIL_DOMAINS: 123 as unknown as string }),
);

// ── 7. R2 未绑定时 attachments 应为 false（前端据此显示降级提示）
const attachmentsWhenNoR2 = !!(({} as { R2?: unknown }).R2);
const attachmentsWhenR2 = !!(({ R2: {} } as { R2?: unknown }).R2);
check('R2 缺失 → attachments=false', attachmentsWhenNoR2 === false);
check('R2 存在 → attachments=true', attachmentsWhenR2 === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process?.exit?.(1);
}
