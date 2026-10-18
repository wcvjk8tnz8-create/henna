/**
 * 管理员身份保护。
 *
 * 约定：邮箱 local part 为 `admin` 的账号（如 admin@example.com）
 * 恒为管理员，不允许被降级 —— 包括后台改角色、邀请码注册、OAuth 登录等任何路径。
 *
 * 这样设计的原因：管理员一旦把自己降成普通用户，就再也进不去后台，
 * 没有自救手段（不像密码可以重置）。与其依赖「别手滑」，不如在写库前拦住。
 */
import type { Env } from '../env';
import { qAll, exec } from '../db/query';

/** 判断邮箱是否为受保护的管理员账号 */
export function isProtectedAdmin(email: string | undefined | null): boolean {
  const s = String(email ?? '').trim().toLowerCase();
  const at = s.indexOf('@');
  if (at <= 0) return false;
  return s.slice(0, at) === 'admin';
}

/**
 * 角色裁决：给定邮箱与期望角色，返回实际应写入的角色。
 * 受保护的 admin 前缀一律返回 'admin'。
 */
export function resolveRole(email: string, desired: string | undefined | null): 'admin' | 'user' {
  if (isProtectedAdmin(email)) return 'admin';
  return desired === 'admin' ? 'admin' : 'user';
}

/**
 * 自愈：把库里所有 admin@ 前缀却被降级的账号改回 admin。
 * 用于老数据修复 —— 比如管理员已经把自己改成 user 的情况。
 * @returns 修复的数量
 */
export async function restoreProtectedAdmins(env: Env): Promise<number> {
  try {
    const rows = await qAll<{ id: number; email: string; role: string }>(
      env.DB,
      "SELECT id, email, role FROM user WHERE role <> 'admin'",
    );
    let n = 0;
    for (const r of rows ?? []) {
      if (isProtectedAdmin(r.email)) {
        await exec(env.DB, "UPDATE user SET role = 'admin' WHERE id = ?", r.id);
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}
