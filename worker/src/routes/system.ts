import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import { ok, HttpError } from '../lib/http';
import { ensureSchema } from '../db/schema';
import { qOne, exec, qAll } from '../db/query';
import { parseDomains } from '../lib/util';
import { ensureSelfAddress } from '../lib/selfaddress';
import { restoreProtectedAdmins } from '../lib/admin-guard';
import {
  getAllSettings,
  setSettings,
  toAdmin,
  toPublic,
  isTrue,
  DEFAULT_SETTINGS,
} from '../db/settings';
import { authRequired, adminOnly, authOptional } from '../middleware/auth';
import { recognizeCaptcha } from '../lib/ai';
import { effectiveMode, publicUrl, putObject, getObject, type StorageConfig } from '../lib/storage';

const system = new Hono<{ Bindings: Env }>();

system.get('/health', (c) => c.json(ok({ status: 'ok', ts: Date.now() })));

/** 前端公开配置 */
system.get('/config', async (c) => {
  const s = await getAllSettings(c.env.DB);
  const cfg: StorageConfig = {
    type: (s.storage_type as 'r2' | 's3' | 'none') || 'r2',
    publicDomain: s.storage_public_domain ?? '',
    s3Endpoint: s.s3_endpoint ?? '',
    s3Region: s.s3_region ?? 'auto',
    s3Bucket: s.s3_bucket ?? '',
    s3AccessKey: s.s3_access_key ?? '',
    s3SecretKey: s.s3_secret_key ?? '',
  };
  return c.json(
    ok({
      appName: s.site_title || c.env.APP_NAME || 'Henna Mail',
      domains: parseDomains(c.env),
      allowRegister: isTrue(s.allow_register) && c.env.ALLOW_REGISTER === 'true',
      strategy: c.env.PROVIDER_STRATEGY || 'priority',
      /** 附件是否真的能存 */
      attachments: effectiveMode(cfg, c.env.R2) !== 'none',
      storage: effectiveMode(cfg, c.env.R2),
      /** 登录页需要的公开设置 */
      settings: toPublic(s),
    }),
  );
});

/** 站点设置：管理员读全量（密钥掩码），其他人读公开部分 */
system.get('/settings', authOptional as never, async (c) => {
  const s = await getAllSettings(c.env.DB);
  const user = (c as unknown as { get: (k: string) => { role?: string } | undefined }).get('user');
  return c.json(ok(user?.role === 'admin' ? toAdmin(s) : toPublic(s)));
});

/** 更新站点设置（管理员，部分更新即可） */
system.put('/settings', authRequired as never, adminOnly as never, async (c) => {
  const patch = (await c.req.json().catch(() => ({}))) as Record<string, string>;
  if (!patch || typeof patch !== 'object') throw new HttpError('参数格式不正确');
  const n = await setSettings(c.env.DB, patch);
  return c.json(ok({ updated: n, settings: toAdmin(await getAllSettings(c.env.DB)) }));
});

/** 重置为默认值 */
system.post('/settings/reset', authRequired as never, adminOnly as never, async (c) => {
  await setSettings(c.env.DB, DEFAULT_SETTINGS);
  return c.json(ok({ reset: true, settings: toAdmin(await getAllSettings(c.env.DB)) }));
});

/** 对象存储状态自检（管理员） */
system.get('/storage', authRequired as never, adminOnly as never, async (c) => {
  const s = await getAllSettings(c.env.DB);
  const cfg: StorageConfig = {
    type: (s.storage_type as 'r2' | 's3' | 'none') || 'r2',
    publicDomain: s.storage_public_domain ?? '',
    s3Endpoint: s.s3_endpoint ?? '',
    s3Region: s.s3_region ?? 'auto',
    s3Bucket: s.s3_bucket ?? '',
    s3AccessKey: s.s3_access_key ?? '',
    s3SecretKey: s.s3_secret_key ?? '',
  };
  const mode = effectiveMode(cfg, c.env.R2);
  return c.json(
    ok({
      configured: cfg.type,
      effective: mode,
      r2Bound: !!c.env.R2,
      publicDomain: cfg.publicDomain,
      sampleUrl: publicUrl(cfg, 'att/example.txt'),
      hint:
        mode === 'none'
          ? cfg.type === 's3'
            ? 'S3 配置不完整，请填写端点、桶名、Access Key 与 Secret Key'
            : 'R2 未绑定，请在 Cloudflare 控制台绑定 R2 桶后重新部署'
          : '存储可用',
    }),
  );
});

/**
 * 上传登录背景图（管理员）。
 * 优先写对象存储并返回可访问 URL；存储不可用时退回 data URL（限 512KB 以内）。
 */
system.post('/upload', authRequired as never, adminOnly as never, async (c) => {
  const ct = c.req.header('Content-Type') ?? '';
  let mime = 'image/png';
  let raw: ArrayBuffer;

  if (ct.includes('multipart/form-data')) {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get('file') as unknown;
    if (!file || typeof file === 'string') throw new HttpError('缺少文件', 400);
    const f = file as { type?: string; arrayBuffer(): Promise<ArrayBuffer> };
    mime = f.type || mime;
    raw = await f.arrayBuffer();
  } else {
    const { data, mime: m } = (await c.req.json().catch(() => ({}))) as { data?: string; mime?: string };
    if (!data) throw new HttpError('缺少文件数据', 400);
    if (m) mime = m;
    // data:image/png;base64,xxxx 或纯 base64
    const b64 = data.includes(',') ? data.slice(data.indexOf(',') + 1) : data;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    raw = bytes.buffer;
  }

  const MAX = 4 * 1024 * 1024;
  if (raw.byteLength > MAX) throw new HttpError('图片不能超过 4MB', 400);
  if (!mime.startsWith('image/')) throw new HttpError('只支持图片文件', 400);

  const s = await getAllSettings(c.env.DB);
  const cfg: StorageConfig = {
    type: (s.storage_type as 'r2' | 's3' | 'none') || 'r2',
    publicDomain: s.storage_public_domain ?? '',
    s3Endpoint: s.s3_endpoint ?? '',
    s3Region: s.s3_region ?? 'auto',
    s3Bucket: s.s3_bucket ?? '',
    s3AccessKey: s.s3_access_key ?? '',
    s3SecretKey: s.s3_secret_key ?? '',
  };

  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  const key = `site/login-bg-${Date.now()}.${ext}`;

  try {
    await putObject(cfg, c.env.R2, key, raw, { contentType: mime });
    const url = publicUrl(cfg, key);
    if (url) return c.json(ok({ url, storage: effectiveMode(cfg, c.env.R2) }));
    // 有存储但没配访问域名：走站内代理
    return c.json(ok({ url: `/api/system/asset/${key}`, storage: effectiveMode(cfg, c.env.R2) }));
  } catch (e) {
    // 存储不可用：小图退回 data URL，保证功能不残废
    if (raw.byteLength <= 512 * 1024) {
      let b64 = '';
      const bytes = new Uint8Array(raw);
      for (let i = 0; i < bytes.length; i++) b64 += String.fromCharCode(bytes[i]);
      b64 = btoa(b64);
      return c.json(
        ok({ url: `data:${mime};base64,${b64}`, storage: 'none', hint: '对象存储不可用，已内联保存（不超过 512KB）' }),
      );
    }
    throw new HttpError(`上传失败：${(e as Error).message}`, 500);
  }
});

/** 站内对象代理：未配置公开域名时也能访问存储里的文件 */
system.get('/asset/*', async (c) => {
  const key = c.req.path.replace('/api/system/asset/', '');
  if (!key || key.includes('..')) throw new HttpError('路径不合法', 400);
  const s = await getAllSettings(c.env.DB);
  const cfg: StorageConfig = {
    type: (s.storage_type as 'r2' | 's3' | 'none') || 'r2',
    publicDomain: '',
    s3Endpoint: s.s3_endpoint ?? '',
    s3Region: s.s3_region ?? 'auto',
    s3Bucket: s.s3_bucket ?? '',
    s3AccessKey: s.s3_access_key ?? '',
    s3SecretKey: s.s3_secret_key ?? '',
  };
  const obj = await getObject(cfg, c.env.R2, key).catch(() => null);
  if (!obj) throw new HttpError('文件不存在', 404);
  const headers = new Headers();
  headers.set('Content-Type', obj.contentType);
  headers.set('Cache-Control', 'public, max-age=31536000');
  return new Response(obj.body, { headers });
});

/** Workers AI 验证码识别（登录用户可用） */
system.post('/ai-ocr', authRequired as never, async (c) => {
  const s = await getAllSettings(c.env.DB);
  if (!isTrue(s.ai_enabled)) throw new HttpError('Workers AI 未启用', 400);
  const { image } = (await c.req.json().catch(() => ({}))) as { image?: string };
  if (!image) throw new HttpError('缺少图片数据');
  const text = await recognizeCaptcha(
    {
      enabled: true,
      model: s.ai_model,
      accountId: s.ai_account_id || (c.env.CF_ACCOUNT_ID ?? ''),
      apiToken: s.ai_api_token || (c.env.CF_API_TOKEN ?? ''),
    },
    image,
  );
  return c.json(ok({ text }));
});

/**
 * 幂等初始化：建表 + 播种默认服务商。脚本与 Actions 部署后自动调用。
 * 同时挂在 /api/system/init/:secret 与短路径 /api/init/:secret
 * （后者是 cloud-mail 的惯例，部署脚本用的就是它）。
 *
 * 响应体约定：纯文本 "success"。部署脚本以此判定成败，不要改成 JSON。
 */
export const initHandler = async (c: Context<{ Bindings: Env }>) => {
  if (c.req.param('secret') !== c.env.JWT_SECRET) throw new HttpError('密钥不匹配', 401);
  await ensureSchema(c.env.DB);

  const n = await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM mail_provider');
  if (!n || n.n === 0) {
    const now = Date.now();
    await exec(
      c.env.DB,
      'INSERT INTO mail_provider (name, kind, config, enabled, weight, daily_used, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?)',
      'Noop 自测通道',
      'noop',
      '{}',
      1,
      1,
      now,
      now,
    );
  }

  // 自愈：把 admin@ 前缀却被降级的账号改回管理员（老数据修复，幂等）
  try {
    await restoreProtectedAdmins(c.env);
  } catch {
    /* 修复失败不影响初始化 */
  }

  // 给已存在的账号补上「登录邮箱」作为发件地址（老数据升级用，幂等）
  try {
    const users = await qAll<{ id: number; email: string }>(
      c.env.DB,
      'SELECT id, email FROM user ORDER BY id',
    );
    for (const u of users ?? []) {
      await ensureSelfAddress(c.env, u.id, u.email);
    }
  } catch {
    /* 补建失败不影响初始化 */
  }

  await qOne<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM user');

  // 部署脚本以响应体是否为 "success" 判定成败，这里返回纯文本
  return new Response('success', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

system.get('/init/:secret', initHandler);

export default system;
