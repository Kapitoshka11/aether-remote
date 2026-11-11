export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DEVICE_ID = /^[0-9a-f]{64}$/;
export const MAX_FRAME = 256 * 1024;
export const WINDOW = 1024 * 1024;
export type JoinChallenge = {
  ownerId: string; sessionId: string; role: 'host' | 'phone'; deviceId: string; nonce: string; expiresAt: number;
};
export function canonicalJoin(value: JoinChallenge): Uint8Array<ArrayBuffer> {
  if (!UUID.test(value.ownerId) || !UUID.test(value.sessionId) || !DEVICE_ID.test(value.deviceId) ||
      !['host', 'phone'].includes(value.role) || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) ||
      !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= 0) throw new Error('invalid_join');
  return new TextEncoder().encode(['AETHER_RELAY_JOIN_V1', value.ownerId, value.sessionId,
    value.role, value.deviceId, value.nonce, value.expiresAt].join('\n'));
}
export function base64url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}
export async function keyId(spki: string): Promise<string> {
  if (typeof spki !== 'string' || !/^[A-Za-z0-9+/]{80,200}={0,2}$/.test(spki)) throw new Error('invalid_device_key');
  const bytes = decode(spki);
  await crypto.subtle.importKey('spki', bytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error('invalid_der');
  let offset = 2;
  function integer(): Uint8Array {
    if (der[offset++] !== 2) throw new Error('invalid_der');
    const length = der[offset++];
    if (length < 1 || length > 33 || offset + length > der.length) throw new Error('invalid_der');
    let bytes = der.slice(offset, offset + length); offset += length;
    if (bytes[0] & 0x80) throw new Error('invalid_der');
    if (bytes.length > 1 && bytes[0] === 0) {
      if (!(bytes[1] & 0x80)) throw new Error('invalid_der');
      bytes = bytes.slice(1);
    }
    if (bytes.length > 32) throw new Error('invalid_der');
    const result = new Uint8Array(32); result.set(bytes, 32 - bytes.length); return result;
  }
  const r = integer(), s = integer();
  if (offset !== der.length) throw new Error('invalid_der');
  return new Uint8Array([...r, ...s]);
}
export async function verifyJoin(value: JoinChallenge, signature: string, spki: string): Promise<boolean> {
  try {
    if (!/^[A-Za-z0-9_-]{90,100}$/.test(signature) || base64url(decode(signature)) !== signature || await keyId(spki) !== value.deviceId) return false;
    const key = await crypto.subtle.importKey('spki', decode(spki), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToRaw(decode(signature)), canonicalJoin(value));
  } catch { return false; }
}
