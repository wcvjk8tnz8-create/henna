import { Hono } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { authRequired, type AppEnv } from '../middleware/auth';
import { qAll, qOne, exec } from '../db/query';
import { PROVIDERS, listProviderMeta, type ProviderRow } from '../providers';
import type { ProviderConfig, ProviderKind } from '../providers/types';

const provider = new Hono<{ Bindings: Env; Variables: AppEnv['Variables'] }>();

const SECRET_KEYS = ['apiKey', 'password', 'api_key'];

function maskConfig(cfg: ProviderConfig): ProviderConfig {
  const out: ProviderConfig = { ...cfg };
  for (const k of SECRET_KEYS) if (out[k]) out[k] = '••••••••';
  return out;
}

function parseConfig(raw: string): ProviderConfig {
  try {
    return JSON.parse(raw || '{}') as ProviderConfig;
  } catch {
    return {};
  }
}

/** 可选：服务商元数据（kind / label / 表单字段），供前端动态渲染配置表单 */
provider.get('/meta', authRequired, (c) => c.json(ok(listProviderMeta())));

provider.get('/', authRequired, async (c) => {
  const rows = await qAll<ProviderRow>(c.env.DB, 'SELECT * FROM mail_provider ORDER BY weight DESC, id ASC');
  return c.json(
    ok(
      rows.map((r) => ({
        ...r,
        config: maskConfig(parseConfig(r.config)),
        label: PROVIDERS[r.kind]?.label ?? r.kind,
      })),
    ),
  );
});

provider.post('/', authRequired, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') throw new HttpError('需要管理员权限', 403);
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    kind?: ProviderKind;
    config?: ProviderConfig;
    weight?: number;
    enabled?: number;
  };
  if (!body.kind || !PROVIDERS[body.kind]) throw new HttpError('未知服务商类型');
  const required = (PROVIDERS[body.kind].fields ?? []).filter((f) => f.required);
  for (const f of required) {
    if (!body.config?.[f.key]) throw new HttpError(`缺少必填项：${f.label}`);
  }
  const now = Date.now();
  await exec(
    c.env.DB,
    'INSERT INTO mail_provider (name, kind, config, enabled, weight, daily_used, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)',
    body.name || PROVIDERS[body.kind].label,
    body.kind,
    JSON.stringify(body.config ?? {}),
    body.enabled ?? 1,
    body.weight ?? 100,
    now,
    now,
  );
  return c.json(ok({ created: true }));
});

provider.put('/:id', authRequired, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') throw new HttpError('需要管理员权限', 403);
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    kind?: ProviderKind;
    config?: ProviderConfig;
    weight?: number;
    enabled?: number;
  };
  const row = await qOne<ProviderRow>(c.env.DB, 'SELECT * FROM mail_provider WHERE id = ?', id);
  if (!row) throw new HttpError('服务商不存在', 404);

  let nextCfg = parseConfig(row.config);
  if (body.config) {
    for (const [k, v] of Object.entries(body.config)) {
      if (SECRET_KEYS.includes(k) && v === '••••••••') continue; // 未修改，保留原值
      nextCfg[k] = v;
    }
  }
  await exec(
    c.env.DB,
    'UPDATE mail_provider SET name = ?, kind = ?, config = ?, enabled = ?, weight = ?, updated_at = ? WHERE id = ?',
    body.name ?? row.name,
    body.kind ?? row.kind,
    JSON.stringify(nextCfg),
    body.enabled ?? row.enabled,
    body.weight ?? row.weight,
    Date.now(),
    id,
  );
  return c.json(ok({ updated: true }));
});

provider.delete('/:id', authRequired, async (c) => {
  const user = c.get('user');
  if (user.role !== 'admin') throw new HttpError('需要管理员权限', 403);
  await exec(c.env.DB, 'DELETE FROM mail_provider WHERE id = ?', Number(c.req.param('id')));
  return c.json(ok({ deleted: true }));
});

/** 测试发信：直接用该服务商发一封，验证 Key 是否可用 */
provider.post('/:id/test', authRequired, async (c) => {
  const id = Number(c.req.param('id'));
  const { to } = (await c.req.json().catch(() => ({}))) as { to?: string };
  if (!to) throw new HttpError('缺少收件人');
  const row = await qOne<ProviderRow>(c.env.DB, 'SELECT * FROM mail_provider WHERE id = ?', id);
  if (!row) throw new HttpError('服务商不存在', 404);
  const impl = PROVIDERS[row.kind];
  if (!impl) throw new HttpError('未注册的服务商');
  const cfg = parseConfig(row.config);
  const from = cfg.defaultFrom || `no-reply@${(c.env.MAIL_DOMAINS ? JSON.parse(c.env.MAIL_DOMAINS)[0] : undefined) ?? 'example.com'}`;
  const res = await impl.send(
    {
      from,
      to: [to],
      subject: `[Henna Mail] ${row.name} 连通性测试`,
      text: '这是一封来自 Henna Mail 的连通性测试邮件，收到即表示配置正确。',
      html:
        '<div style="font-family:sans-serif;padding:24px"><h2 style="color:#b4462f">Henna Mail</h2><p>这是一封连通性测试邮件，收到即表示 <b>' +
        row.name +
        '</b> 配置正确。</p></div>',
    },
    cfg,
    c.env,
  );
  if (!res.success) {
    await exec(c.env.DB, 'UPDATE mail_provider SET last_error = ?, updated_at = ? WHERE id = ?', res.error ?? 'failed', Date.now(), id);
  }
  return c.json(ok(res), res.success ? 200 : 502);
});

export default provider;
