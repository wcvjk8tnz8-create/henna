/** PBKDF2-SHA256 口令哈希 + 随机串生成，全部基于 WebCrypto */
const enc = new TextEncoder();

export function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 24): string {
  return randomHex(bytes);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 60000, hash: 'SHA-256' },
    km,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(
  password: string,
  salt: string,
  expected: string,
): Promise<boolean> {
  const actual = await hashPassword(password, salt);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** 简单可逆变长加密，用于存放服务商 API Key（避免明文入库） */
export async function obfuscate(plain: string, secret: string): Promise<string> {
  const km = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret.slice(0, 32).padEnd(32, '0')),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, km, enc.encode(plain));
  const all = new Uint8Array(iv.length + ct.byteLength);
  all.set(iv, 0);
  all.set(new Uint8Array(ct), iv.length);
  return btoa(String.fromCharCode(...all));
}

export async function reveal(blob: string, secret: string): Promise<string> {
  const km = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret.slice(0, 32).padEnd(32, '0')),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const all = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: all.slice(0, 12) },
    km,
    all.slice(12),
  );
  return new TextDecoder().decode(pt);
}
