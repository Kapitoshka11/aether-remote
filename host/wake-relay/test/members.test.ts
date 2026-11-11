import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  connectMemberResponse,
  createCertificate as createCertificateFixture,
  enrollMember,
  registerGroup,
  revokeMember
} from './relay-fixtures';

function der(raw: Uint8Array): Uint8Array {
  const integer = (part: Uint8Array) => {
    let offset = 0;
    while (offset < part.length - 1 && part[offset] === 0) offset += 1;
    const value = part.slice(offset);
    const normalized = (value[0] & 0x80) !== 0 ? new Uint8Array([0, ...value]) : value;
    return new Uint8Array([2, normalized.length, ...normalized]);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function sign(keys: CryptoKeyPair, lines: string[]): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(lines.join('\n'))
  ));
  return b64(der(raw));
}

async function register(groupId: string, deviceId: string, keys: CryptoKeyPair, now: number) {
  const publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)));
  const body = { version: 1, type: 'wake.group.register', groupId, ownerDeviceId: deviceId, ownerPublicKeySpki: publicKey, nonce: crypto.randomUUID().replaceAll('-', ''), issuedAt: now, expiresAt: now + 30_000 };
  const signature = await sign(keys, ['AETHER_WAKE_GROUP/1', 'type=wake.group.register', `groupId=${groupId}`, `ownerDeviceId=${deviceId}`, `ownerPublicKeySpki=${publicKey}`, `nonce=${body.nonce}`, `issuedAt=${now}`, `expiresAt=${now + 30_000}`]);
  return SELF.fetch('https://relay.test/v1/groups', { method: 'POST', body: JSON.stringify({ ...body, signature }) });
}

async function certificate(groupId: string, deviceId: string, role: string, memberKeys: CryptoKeyPair, signerKeys: CryptoKeyPair, now: number) {
  const publicKeySpki = b64(new Uint8Array(await crypto.subtle.exportKey('spki', memberKeys.publicKey)));
  const expiresAt = now + 31_536_000_000;
  const body = { version: 1, type: 'wake.membership', groupId, deviceId, role, publicKeySpki, issuedAt: now, expiresAt };
  const signature = await sign(signerKeys, ['AETHER_WAKE_MEMBER/1', 'type=wake.membership', `groupId=${groupId}`, `deviceId=${deviceId}`, `role=${role}`, `publicKeySpki=${publicKeySpki}`, `issuedAt=${now}`, `expiresAt=${expiresAt}`]);
  return { ...body, signature };
}

describe('home group members', () => {
  it('enrolls an owner-signed member idempotently and rejects a forged member', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const ownerKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    expect((await register(groupId, ownerId, ownerKeys, now)).status).toBe(201);

    const memberId = crypto.randomUUID().replaceAll('-', '');
    const memberKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const valid = await certificate(groupId, memberId, 'phone', memberKeys, ownerKeys, now);
    const post = (body: unknown) => SELF.fetch(`https://relay.test/v1/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(body) });

    expect((await post(valid)).status).toBe(201);
    expect((await post(valid)).status).toBe(200);

    const forgedId = crypto.randomUUID().replaceAll('-', '');
    const forged = await certificate(groupId, forgedId, 'bridge', memberKeys, memberKeys, now);
    expect((await post(forged)).status).toBe(401);
  });

  it('prevents a revoked member certificate from reconnecting', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const memberId = crypto.randomUUID().replaceAll('-', '');
    const options = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const ownerKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    const memberKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    expect((await registerGroup(groupId, ownerId, ownerKeys, now)).status).toBe(201);
    const member = await createCertificateFixture(groupId, memberId, 'phone', memberKeys, ownerKeys, now);
    expect((await enrollMember(groupId, member)).status).toBe(201);
    expect((await connectMemberResponse(groupId, memberId, member)).status).toBe(101);

    expect((await revokeMember(groupId, ownerId, memberId, ownerKeys, now)).status).toBe(200);
    expect((await connectMemberResponse(groupId, memberId, member)).status).toBe(401);
  });
});
