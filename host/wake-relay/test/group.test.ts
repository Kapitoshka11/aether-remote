import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const integer = (part: Uint8Array): Uint8Array => {
    let offset = 0;
    while (offset < part.length - 1 && part[offset] === 0) offset += 1;
    const value = part.slice(offset);
    const prefixed = (value[0] & 0x80) !== 0 ? new Uint8Array([0, ...value]) : value;
    return new Uint8Array([0x02, prefixed.length, ...prefixed]);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function registration(groupId: string, ownerDeviceId: string, keys: CryptoKeyPair, now: number) {
  const ownerPublicKeySpki = base64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)));
  const body = {
    version: 1,
    type: 'wake.group.register',
    groupId,
    ownerDeviceId,
    ownerPublicKeySpki,
    nonce: '0123456789abcdeffedcba9876543210',
    issuedAt: now,
    expiresAt: now + 30_000
  };
  const canonical = new TextEncoder().encode([
    'AETHER_WAKE_GROUP/1',
    'type=wake.group.register',
    `groupId=${body.groupId}`,
    `ownerDeviceId=${body.ownerDeviceId}`,
    `ownerPublicKeySpki=${body.ownerPublicKeySpki}`,
    `nonce=${body.nonce}`,
    `issuedAt=${body.issuedAt}`,
    `expiresAt=${body.expiresAt}`
  ].join('\n'));
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, canonical));
  return { ...body, signature: base64(rawSignatureToDer(raw)) };
}

async function post(body: unknown): Promise<Response> {
  return SELF.fetch('https://relay.test/v1/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('home group registration', () => {
  it('is idempotent for one owner and rejects a conflicting owner', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerDeviceId = crypto.randomUUID().replaceAll('-', '');
    const ownerKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const request = await registration(groupId, ownerDeviceId, ownerKeys, now);

    expect((await post(request)).status).toBe(201);
    expect((await post(request)).status).toBe(200);

    const conflictingKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const conflict = await registration(groupId, crypto.randomUUID().replaceAll('-', ''), conflictingKeys, now);
    expect((await post(conflict)).status).toBe(409);
  });

  it('rejects an expired owner proof', async () => {
    const now = Date.now() - 31_000;
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const request = await registration(crypto.randomUUID().replaceAll('-', ''), crypto.randomUUID().replaceAll('-', ''), keys, now);

    expect((await post(request)).status).toBe(401);
  });
});
