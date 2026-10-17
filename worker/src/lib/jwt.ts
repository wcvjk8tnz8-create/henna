/** WebCrypto HMAC-SHA256 实现的 JWT —— Workers 运行时无 node:crypto 依赖 */
import type { Role } from '../env';

export interface JwtPayload {
  sub: number;
  email: string;
  role: Role;
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signJwt(
  payload: Omit<JwtPayload, 'exp'>,
  secret: string,
  ttlSeconds = 60 * 60 * 24 * 7,
): Promise<string> {
  const header = b64urlEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64urlEncode(
    enc.encode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })),
  );
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const ok = await crypto.subtle.verify(
      'HMAC',
      await key(secret),
      b64urlDecode(sig),
      enc.encode(`${header}.${body}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(body))) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
