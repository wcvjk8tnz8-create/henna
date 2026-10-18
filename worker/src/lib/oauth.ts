/**
 * OAuth2 第三方登录：GitHub / Google / LinuxDo。
 *
 * 流程：
 *   1. GET /api/oauth/:provider/authorize  → 返回授权 URL + state
 *   2. 前端跳转授权页
 *   3. GET /api/oauth/:provider/callback   → 换 token、拉用户信息、
 *      查找或创建本地用户、签 JWT、302 回前端 /#/oauth?token=...
 *
 * state 存 KV（5 分钟有效），防 CSRF。
 */

export interface OAuthProvider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
  /** 从 token 响应里取 access_token */
  parseToken: (json: Record<string, unknown>) => string;
  /** 从用户信息里取 (email, 外部 id, 昵称) */
  parseUser: (json: Record<string, unknown>) => { email: string; externalId: string; name: string };
  /** 拉取用户信息时的请求头构造 */
  userHeaders: (accessToken: string) => Record<string, string>;
}

export const PROVIDERS: Record<string, OAuthProvider> = {
  github: {
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    parseToken: (j) => String(j.access_token ?? ''),
    parseUser: (j) => ({
      email: String(j.email ?? ''),
      externalId: String(j.id ?? ''),
      name: String(j.login ?? j.name ?? ''),
    }),
    userHeaders: (t) => ({
      Authorization: `Bearer ${t}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Henna-Mail',
    }),
  },
  google: {
    name: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    parseToken: (j) => String(j.access_token ?? ''),
    parseUser: (j) => ({
      email: String(j.email ?? ''),
      externalId: String(j.sub ?? ''),
      name: String(j.name ?? j.email ?? ''),
    }),
    userHeaders: (t) => ({ Authorization: `Bearer ${t}` }),
  },
  linuxdo: {
    name: 'LinuxDo',
    authorizeUrl: 'https://connect.linux.do/oauth2/authorize',
    tokenUrl: 'https://connect.linux.do/oauth2/token',
    userInfoUrl: 'https://connect.linux.do/api/user',
    scope: 'user',
    parseToken: (j) => String(j.access_token ?? ''),
    parseUser: (j) => ({
      email: String(j.email ?? ''),
      externalId: String(j.id ?? j.username ?? ''),
      name: String(j.username ?? j.name ?? ''),
    }),
    userHeaders: (t) => ({ Authorization: `Bearer ${t}` }),
  },
};

/** GitHub 的主接口不返回未公开邮箱，需单独拉一次 */
export async function fetchGithubEmail(accessToken: string): Promise<string> {
  try {
    const res = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Henna-Mail',
      },
    });
    const list = (await res.json()) as Array<{ email?: string; primary?: boolean; verified?: boolean }>;
    if (!Array.isArray(list)) return '';
    const primary = list.find((e) => e.primary && e.verified) ?? list.find((e) => e.verified);
    return String(primary?.email ?? list[0]?.email ?? '');
  } catch {
    return '';
  }
}

export function buildAuthorizeUrl(
  p: OAuthProvider,
  opts: { clientId: string; redirectUri: string; state: string },
): string {
  const u = new URL(p.authorizeUrl);
  u.searchParams.set('client_id', opts.clientId);
  u.searchParams.set('redirect_uri', opts.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', p.scope);
  u.searchParams.set('state', opts.state);
  return u.toString();
}

export async function exchangeCode(
  p: OAuthProvider,
  opts: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<string> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(p.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const token = p.parseToken(json);
  if (!token) throw new Error(`换取 access_token 失败：${JSON.stringify(json).slice(0, 200)}`);
  return token;
}

export async function fetchProfile(
  p: OAuthProvider,
  accessToken: string,
): Promise<{ email: string; externalId: string; name: string }> {
  const res = await fetch(p.userInfoUrl, { headers: p.userHeaders(accessToken) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const u = p.parseUser(json);
  if (p.name === 'GitHub' && !u.email) {
    u.email = await fetchGithubEmail(accessToken);
  }
  // LinuxDo 可能不返回邮箱，用 externalId 兜底造一个站内唯一标识
  if (!u.email && u.externalId) {
    u.email = `${u.externalId}@${p.name.toLowerCase()}.local`;
  }
  return u;
}
