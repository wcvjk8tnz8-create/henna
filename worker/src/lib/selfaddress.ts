/**
 * 发件地址自愈：确保「自己的登录邮箱」一定在 mail_address 表里。
 *
 * 背景：发信页的发件人下拉读的是 mail_address 表，而注册只写 user 表，
 * 于是管理员（如 admin@r0.us.ci）登录后下拉里空空如也，无法用自己的
 * 登录邮箱发信。这里在每次 /api/auth/me 时幂等补一条，成本极低
 * （一次 SELECT + 必要时一次 INSERT），且对已有数据零影响。
 */
import type { Env } from '../env';
import { qOne, exec } from '../db/query';
import { domainOf, parseDomains } from './util';

/**
 * @param userId  用户 id
 * @param email   登录邮箱
 * @returns true 表示本次新建了一条
 */
export async function ensureSelfAddress(env: Env, userId: number, email: string): Promise<boolean> {
  const addr = String(email ?? '').trim().toLowerCase();
  if (!addr.includes('@')) return false;

  const domains = parseDomains(env);
  // 登录邮箱域名不在托管列表内时不强插 —— 否则会造出根本收不到信的发件人
  if (domains.length > 0 && !domains.includes(domainOf(addr))) return false;

  const exist = await qOne<{ id: number }>(env.DB, 'SELECT id FROM mail_address WHERE address = ?', addr);
  if (exist) return false;

  await exec(
    env.DB,
    'INSERT INTO mail_address (user_id, address, domain, enabled, created_at) VALUES (?,?,?,1,?)',
    userId,
    addr,
    domainOf(addr),
    Date.now(),
  );
  return true;
}
