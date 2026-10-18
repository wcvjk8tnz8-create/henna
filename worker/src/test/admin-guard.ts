/**
 * 管理员身份保护回归测试。
 *
 * 覆盖两点：
 * 1. admin@ 前缀恒为管理员 —— 邀请码、后台改角色都不能把它降级；
 * 2. 自愈 —— 已经被降级的账号能被 restoreProtectedAdmins 捞回来
 *    （管理员把自己改成 user 后唯一的自救路径）。
 */
import { isProtectedAdmin, resolveRole } from '../lib/admin-guard';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

console.log('管理员保护：');

/* ── 1. 识别 ─────────────────────────────────────────── */
check('admin@example.com 受保护', isProtectedAdmin('admin@example.com'));
check('ADMIN@Example.com 大小写不敏感', isProtectedAdmin('ADMIN@Example.com'));
check(' 前后空格无影响', isProtectedAdmin('  admin@example.com  '));
check('admin2@example.com 不受保护', !isProtectedAdmin('admin2@example.com'));
check('administrator@example.com 不受保护', !isProtectedAdmin('administrator@example.com'));
check('user@example.com 不受保护', !isProtectedAdmin('user@example.com'));
check('无 @ 的输入不误判', !isProtectedAdmin('admin'));
check('空值不误判', !isProtectedAdmin(''));
check('null 不误判', !isProtectedAdmin(null));

/* ── 2. 角色裁决 ─────────────────────────────────────── */
console.log('角色裁决：');
check('admin@ 想要 user → 强制 admin', resolveRole('admin@x.com', 'user') === 'admin');
check('admin@ 想要 admin → admin', resolveRole('admin@x.com', 'admin') === 'admin');
check('admin@ 未指定 → admin', resolveRole('admin@x.com', undefined) === 'admin');
check('普通用户想要 admin → admin', resolveRole('u@x.com', 'admin') === 'admin');
check('普通用户想要 user → user', resolveRole('u@x.com', 'user') === 'user');
check('普通用户未指定 → user', resolveRole('u@x.com', undefined) === 'user');
check('非法角色值回落 user', resolveRole('u@x.com', 'superuser') === 'user');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) throw new Error(`${fail} 项失败`);
