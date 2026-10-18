/**
 * 发信归属校验 + 地址列表作用域
 *
 * 背景一：send.ts 的 guard 里，admin 走的是另一条分支 ——
 * 只要发件域名在托管列表内就放行，于是可以用**任何人的地址**发信。
 * 现在统一按「该地址属于本人」校验，管理员也不例外。
 *
 * 背景二：/mailbox 对 admin 默认返回全站地址，写信页的下拉会列出别人的
 * 邮箱。加 scope=mine 后，写信页只拿自己的。
 */

export {};

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

/** 复刻 send.ts guard 的判定：地址必须属于本人 */
function canSendFrom(
  role: string,
  userId: number,
  addrOwnerId: number | null,
  hostedDomain: boolean,
): boolean {
  // 现在的规则：不看角色，只看归属
  return addrOwnerId !== null && addrOwnerId === userId;
}

/** 复刻旧行为（用于对照，说明这个 bug 确实存在过） */
function oldCanSendFrom(role: string, userId: number, addrOwnerId: number | null, hostedDomain: boolean): boolean {
  if (role !== 'admin') return addrOwnerId !== null && addrOwnerId === userId;
  return hostedDomain;
}

console.log('发信归属：');

/* ── 普通用户 ─────────────────────────────────────── */
check('user 用自己的地址 → 允许', canSendFrom('user', 1, 1, true) === true);
check('user 用别人的地址 → 拒绝', canSendFrom('user', 1, 2, true) === false);
check('user 用不存在的地址 → 拒绝', canSendFrom('user', 1, null, true) === false);

/* ── 管理员：旧逻辑能越权，新逻辑不能 ─────────────── */
check('admin 用自己的地址 → 允许', canSendFrom('admin', 1, 1, true) === true);
check('admin 用别人的地址 → 拒绝（关键修复）', canSendFrom('admin', 1, 2, true) === false);
check('admin 用不存在的地址 → 拒绝', canSendFrom('admin', 1, null, true) === false);
check('admin 域名不在列表 → 拒绝', canSendFrom('admin', 1, 2, false) === false);

console.log('');
console.log('对照：旧逻辑下管理员的越权');
check('旧行为：admin 可用别人的托管地址（bug，现已修）', oldCanSendFrom('admin', 1, 2, true) === true);
check('旧行为：admin 用非托管域名会被拒', oldCanSendFrom('admin', 1, 2, false) === false);

/* ── 地址列表作用域 ───────────────────────────────── */
console.log('');
console.log('地址列表作用域：');

function mailboxScope(role: string, scopeParam: string | null): 'all' | 'mine' {
  const mine = scopeParam === 'mine';
  return mine || role !== 'admin' ? 'mine' : 'all';
}

check('admin 默认 → 全站（管理页要用）', mailboxScope('admin', null) === 'all');
check('admin + scope=mine → 只看自己的', mailboxScope('admin', 'mine') === 'mine');
check('user 默认 → 自己的', mailboxScope('user', null) === 'mine');
check('user + scope=mine → 自己的', mailboxScope('user', 'mine') === 'mine');
check('scope=MINE（大写）不生效', mailboxScope('admin', 'MINE') === 'all');
check('scope=other 不生效', mailboxScope('admin', 'other') === 'all');

console.log('');
console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} 项失败`);
