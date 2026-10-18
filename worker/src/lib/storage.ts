/**
 * 对象存储抽象：R2（binding）与 S3 兼容（SigV4 自签）。
 *
 * storage_type = r2   → 用 Workers R2 binding，零配置
 * storage_type = s3   → 任意 S3 兼容服务（R2 的 S3 API、MinIO、AWS S3…）
 * storage_type = none → 不存文件，只登记元信息
 *
 * 全部方法在配置缺失时返回 null 而不是抛错 —— 附件功能降级，
 * 绝不能因为存储问题让整封邮件收不进来。
 */

export type StorageMode = 'r2' | 's3' | 'none';

export interface StorageConfig {
  type: StorageMode;
  publicDomain: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
  s3SecretKey: string;
}

export interface PutOptions {
  contentType?: string;
}

// ─────────────────────────── AWS SigV4 ───────────────────────────

const enc = new TextEncoder();

async function hmac(key: Uint8Array | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    'raw',
    key as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256hex(data: ArrayBuffer | string): Promise<string> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  return toHex(await crypto.subtle.digest('SHA-256', buf as ArrayBuffer));
}

/** 按 AWS SigV4 规范给请求签名 */
async function signRequest(
  cfg: StorageConfig,
  method: 'GET' | 'PUT' | 'DELETE',
  path: string,
  body: ArrayBuffer | null,
  contentType: string,
): Promise<Record<string, string>> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(cfg.s3Endpoint).host;
  const payloadHash = await sha256hex(body ?? '');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    path,
    '', // 无 query
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.s3Region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256hex(canonicalRequest),
  ].join('\n');

  let key = await hmac(enc.encode(`AWS4${cfg.s3SecretKey}`).buffer as ArrayBuffer, dateStamp);
  key = await hmac(key, cfg.s3Region);
  key = await hmac(key, 's3');
  key = await hmac(key, 'aws4_request');
  const signature = toHex(await hmac(key, stringToSign));

  return {
    Host: host,
    'X-Amz-Date': amzDate,
    'X-Amz-Content-Sha256': payloadHash,
    'Content-Type': contentType,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${cfg.s3AccessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function s3Path(cfg: StorageConfig, key: string): string {
  // 若端点已含桶名（常见写法 https://xxx.r2.cloudflarestorage.com/bucket），
  // 就直接用端点前缀 + key
  const u = new URL(cfg.s3Endpoint);
  if (u.pathname.replace(/\/$/, '').endsWith(`/${cfg.s3Bucket}`)) {
    return `${u.pathname.replace(/\/$/, '')}/${encodeURI(key)}`;
  }
  return `/${cfg.s3Bucket}/${encodeURI(key)}`;
}

// ─────────────────────────── 对外接口 ───────────────────────────

export interface StoredObject {
  body: ReadableStream | ArrayBuffer;
  contentType: string;
}

/**
 * 写入对象。返回实际使用的存储方式；'none' 表示没存文件。
 * 失败时抛错，由调用方决定是否降级。
 */
export async function putObject(
  cfg: StorageConfig,
  r2: R2Bucket | undefined,
  key: string,
  data: ArrayBuffer | string,
  opts: PutOptions = {},
): Promise<StorageMode> {
  if (cfg.type === 'none') return 'none';
  const contentType = opts.contentType ?? 'application/octet-stream';
  const buf = typeof data === 'string' ? enc.encode(data) : data;

  if (cfg.type === 'r2') {
    if (!r2) throw new Error('R2 未绑定');
    await r2.put(key, buf, { httpMetadata: { contentType } });
    return 'r2';
  }

  // S3
  if (!cfg.s3Endpoint || !cfg.s3AccessKey || !cfg.s3SecretKey || !cfg.s3Bucket) {
    throw new Error('S3 配置不完整');
  }
  const path = s3Path(cfg, key);
  const headers = await signRequest(cfg, 'PUT', path, buf as unknown as ArrayBuffer, contentType);
  const res = await fetch(`${cfg.s3Endpoint}${path}`, {
    method: 'PUT',
    headers,
    body: buf as BufferSource,
  });
  if (!res.ok) throw new Error(`S3 写入失败：${res.status} ${(await res.text()).slice(0, 200)}`);
  return 's3';
}

/** 读取对象 */
export async function getObject(
  cfg: StorageConfig,
  r2: R2Bucket | undefined,
  key: string,
): Promise<StoredObject | null> {
  if (cfg.type === 'none') return null;

  if (cfg.type === 'r2') {
    if (!r2) return null;
    const obj = await r2.get(key);
    if (!obj) return null;
    return { body: obj.body, contentType: obj.httpMetadata?.contentType ?? 'application/octet-stream' };
  }

  if (!cfg.s3Endpoint || !cfg.s3AccessKey || !cfg.s3SecretKey || !cfg.s3Bucket) return null;
  const path = s3Path(cfg, key);
  const headers = await signRequest(cfg, 'GET', path, null, 'application/octet-stream');
  const res = await fetch(`${cfg.s3Endpoint}${path}`, { method: 'GET', headers });
  if (!res.ok || !res.body) return null;
  return { body: res.body, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
}

/** 删除对象 */
export async function deleteObject(
  cfg: StorageConfig,
  r2: R2Bucket | undefined,
  key: string,
): Promise<void> {
  if (cfg.type === 'none') return;
  try {
    if (cfg.type === 'r2') {
      if (!r2) return;
      await r2.delete(key);
      return;
    }
    if (!cfg.s3Endpoint || !cfg.s3AccessKey || !cfg.s3SecretKey || !cfg.s3Bucket) return;
    const path = s3Path(cfg, key);
    const headers = await signRequest(cfg, 'DELETE', path, null, 'application/octet-stream');
    await fetch(`${cfg.s3Endpoint}${path}`, { method: 'DELETE', headers });
  } catch {
    /* 删不掉就算了，不要影响主流程 */
  }
}

/** 生成附件的公开访问链接（配置了 publicDomain 时） */
export function publicUrl(cfg: StorageConfig, key: string): string | null {
  if (!cfg.publicDomain) return null;
  return `${cfg.publicDomain.replace(/\/$/, '')}/${key}`;
}

/** 当前实际可用的存储方式（供状态展示） */
export function effectiveMode(cfg: StorageConfig, r2: R2Bucket | undefined): StorageMode {
  if (cfg.type === 'none') return 'none';
  if (cfg.type === 'r2') return r2 ? 'r2' : 'none';
  if (cfg.s3Endpoint && cfg.s3AccessKey && cfg.s3SecretKey && cfg.s3Bucket) return 's3';
  return 'none';
}
