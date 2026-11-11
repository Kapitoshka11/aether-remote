import { SELF } from 'cloudflare:test';

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

export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

export async function sign(keys: CryptoKeyPair, lines: string[]): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    keys.privateKey,
    new TextEncoder().encode(lines.join('\n'))
  ));
  return base64(der(raw));
}

export async function registerGroup(groupId: string, deviceId: string, keys: CryptoKeyPair, now: number): Promise<Response> {
  const publicKey = base64(new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey)));
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const expiresAt = now + 30_000;
  const signature = await sign(keys, ['AETHER_WAKE_GROUP/1', 'type=wake.group.register', `groupId=${groupId}`, `ownerDeviceId=${deviceId}`, `ownerPublicKeySpki=${publicKey}`, `nonce=${nonce}`, `issuedAt=${now}`, `expiresAt=${expiresAt}`]);
  return SELF.fetch('https://relay.test/v1/groups', {
    method: 'POST',
    body: JSON.stringify({ version: 1, type: 'wake.group.register', groupId, ownerDeviceId: deviceId, ownerPublicKeySpki: publicKey, nonce, issuedAt: now, expiresAt, signature })
  });
}

export async function createCertificate(groupId: string, deviceId: string, role: string, memberKeys: CryptoKeyPair, ownerKeys: CryptoKeyPair, now: number) {
  const publicKeySpki = base64(new Uint8Array(await crypto.subtle.exportKey('spki', memberKeys.publicKey)));
  const expiresAt = now + 31_536_000_000;
  const signature = await sign(ownerKeys, ['AETHER_WAKE_MEMBER/1', 'type=wake.membership', `groupId=${groupId}`, `deviceId=${deviceId}`, `role=${role}`, `publicKeySpki=${publicKeySpki}`, `issuedAt=${now}`, `expiresAt=${expiresAt}`]);
  return { version: 1, type: 'wake.membership', groupId, deviceId, role, publicKeySpki, issuedAt: now, expiresAt, signature };
}

export async function enrollMember(groupId: string, certificate: unknown): Promise<Response> {
  return SELF.fetch(`https://relay.test/v1/groups/${groupId}/members`, { method: 'POST', body: JSON.stringify(certificate) });
}

function base64Url(value: string): string {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function connectMemberResponse(groupId: string, deviceId: string, certificate: unknown): Promise<Response> {
  return SELF.fetch(
    `https://relay.test/v1/groups/${groupId}/socket?deviceId=${deviceId}&certificate=${encodeURIComponent(base64Url(JSON.stringify(certificate)))}`,
    { headers: { Upgrade: 'websocket' } }
  );
}

export async function connectMember(groupId: string, deviceId: string, certificate: unknown): Promise<WebSocket> {
  const response = await connectMemberResponse(groupId, deviceId, certificate);
  if (response.status !== 101 || !response.webSocket) throw new Error(`socket_failed_${response.status}`);
  response.webSocket.accept();
  return response.webSocket;
}

export async function signedWake(groupId: string, senderDeviceId: string, targetDeviceId: string, keys: CryptoKeyPair, now: number, nonce = crypto.randomUUID().replaceAll('-', '')) {
  const expiresAt = now + 30_000;
  const lines = ['AETHER_WAKE/1', 'type=wake.request', `groupId=${groupId}`, `targetDeviceId=${targetDeviceId}`, `senderDeviceId=${senderDeviceId}`, `nonce=${nonce}`, `issuedAt=${now}`, `expiresAt=${expiresAt}`];
  return { version: 1, type: 'wake.request', groupId, targetDeviceId, senderDeviceId, nonce, issuedAt: now, expiresAt, signature: await sign(keys, lines) };
}

export async function revokeMember(groupId: string, ownerDeviceId: string, deviceId: string, ownerKeys: CryptoKeyPair, now: number): Promise<Response> {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const expiresAt = now + 30_000;
  const signature = await sign(ownerKeys, ['AETHER_WAKE_REVOKE/1', 'type=wake.member.revoke', `groupId=${groupId}`, `ownerDeviceId=${ownerDeviceId}`, `deviceId=${deviceId}`, `nonce=${nonce}`, `issuedAt=${now}`, `expiresAt=${expiresAt}`]);
  return SELF.fetch(`https://relay.test/v1/groups/${groupId}/revoke`, {
    method: 'POST',
    body: JSON.stringify({ version: 1, type: 'wake.member.revoke', groupId, ownerDeviceId, deviceId, nonce, issuedAt: now, expiresAt, signature })
  });
}

export function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    socket.addEventListener('message', event => {
      try {
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    }, { once: true });
  });
}
