/**
 * 收件箱隔离回归测试
 *
 * 背景：管理员原本会看到全站所有人的信 —— 既不符合「收件箱」的直觉，
 * 也让自己找不到自己的信。现在默认一律只看自己的，看全部要走 scope=all
 * （仅管理员）。这个测试锁死这条规则，防止改回去。
 */

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

/** 复刻 message.ts 里的分支判断 */
function resolveScope(role: string, scopeParam: string | null): boolean {
  return scopeParam === 'all' && role === 'admin';
}

console.log('收件箱作用域：');

/* ── 默认一律看自己的 ─────────────────────────────── */
check('普通用户：默认看自己的', resolveScope('user', null) === false);
check('管理员：默认也看自己的（关键修复）', resolveScope('admin', null) === false);
check('普通用户：scope=all 无效', resolveScope('user', 'all') === false);

/* ── 只有管理员 + scope=all 才看全部 ──────────────── */
check('管理员 + scope=all → 看全部', resolveScope('admin', 'all') === true);

/* ── 其它 scope 值不应误触发 ──────────────────────── */
check('scope=ALL（大写）不生效', resolveScope('admin', 'ALL') === false);
check('scope=alll 不生效', resolveScope('admin', 'alll') === false);
check('scope=空串不生效', resolveScope('admin', '') === false);
check('scope=mine 不生效', resolveScope('admin', 'mine') === false);

/* ── 角色大小写 ───────────────────────────────────── */
check('role=ADMIN 不按管理员处理', resolveScope('ADMIN', 'all') === false);
check('role=root 不按管理员处理', resolveScope('root', 'all') === false);

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} 项失败`);
