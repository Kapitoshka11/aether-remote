import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { base64url, canonicalJoin, keyId, type JoinChallenge } from '../src/protocol';
import type { Env } from '../src/index';

async function identity() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeySpki = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))));
  return { keys, publicKeySpki, id: await keyId(publicKeySpki) };
}
function der(raw: Uint8Array) {
  function integer(part: Uint8Array) {
    let first = 0;
    while (first < part.length - 1 && part[first] === 0) first++;
    const bytes = part.slice(first);
    const value = bytes[0] & 0x80 ? new Uint8Array([0, ...bytes]) : bytes;
    return new Uint8Array([2, value.length, ...value]);
  }
  const r = integer(raw.slice(0, 32)), s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}
async function sign(challenge: JoinChallenge, key: CryptoKey) {
  return base64url(der(new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, canonicalJoin(challenge)))));
}
function inbox(socket: WebSocket) {
  socket.binaryType = 'arraybuffer';
  const messages: any[] = [], waiters: Array<(value: any) => void> = [];
  const closed = new Promise<void>(resolve => socket.addEventListener('close', () => resolve()));
  socket.addEventListener('message', event => {
    const value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    const waiter = waiters.shift(); if (waiter) waiter(value); else messages.push(value);
  });
  socket.accept();
  return { socket, closed, next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise<any>(resolve => waiters.push(resolve)) };
}
async function setup() {
  const namespace = (env as unknown as Env).ACCOUNT_TUNNELS;
  const ownerId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  const stub = namespace.get(namespace.idFromName(`${ownerId}:${sessionId}`));
  const host = await identity(), phone = await identity();
  const join = async (role: 'host' | 'phone', changes = {}) => {
    const device = role === 'host' ? host : phone;
    const response = await stub.fetch('https://account-tunnel/join', { headers: { Upgrade: 'websocket',
      'X-Aether-Admission': JSON.stringify({ ownerId, sessionId, role, deviceId: device.id, publicKeySpki: device.publicKeySpki,
        tokenExpiresAt: Date.now() + 60000, admissionExpiresAt: Date.now() + 90000, ...changes }) } });
    return response;
  };
  return { join, host, phone, ownerId, sessionId };
}

describe('account relay authorization and carrier', () => {
  it('rejects unauthenticated public joins and token query strings', async () => {
    expect((await SELF.fetch(`https://relay.test/v1/connect/${crypto.randomUUID()}/phone`, { headers: { Upgrade: 'websocket' } })).status).toBe(401);
    expect((await SELF.fetch(`https://relay.test/v1/connect/${crypto.randomUUID()}/phone?token=forbidden`, { headers: { Upgrade: 'websocket' } })).status).toBe(400);
  });
  it('requires both device signatures before forwarding and validates acknowledgements', async () => {
    const fixture = await setup();
    const host = inbox((await fixture.join('host')).webSocket!);
    const phone = inbox((await fixture.join('phone')).webSocket!);
    try {
      const hostChallenge = await host.next(), phoneChallenge = await phone.next();
      host.socket.send(JSON.stringify({ type: 'proof', signature: await sign(hostChallenge, fixture.host.keys.privateKey) }));
      phone.socket.send(JSON.stringify({ type: 'proof', signature: await sign(phoneChallenge, fixture.phone.keys.privateKey) }));
      expect((await host.next()).type).toBe('ready');
      expect((await phone.next()).type).toBe('ready');
      const frame = new Uint8Array([0, 0, 0, 0, 0, 11, 22, 33]);
      phone.socket.send(frame);
      expect(new Uint8Array(await host.next())).toEqual(frame);
      const ack = new Uint8Array([1, 0, 0, 0, 3]);
      host.socket.send(ack);
      expect(new Uint8Array(await phone.next())).toEqual(ack);
      const closed = phone.closed;
      host.socket.send(new Uint8Array([1, 0, 0, 0, 4]));
      await closed;
      expect(phone.socket.readyState).not.toBe(1);
    } finally { host.socket.close(); phone.socket.close(); }
  });
  it('rejects the wrong private key and closes the peer', async () => {
    const fixture = await setup();
    const host = inbox((await fixture.join('host')).webSocket!);
    const challenge = await host.next();
    host.socket.send(JSON.stringify({ type: 'proof', signature: await sign(challenge, fixture.phone.keys.privateKey) }));
    await host.closed;
    expect(host.socket.readyState).not.toBe(1);
  });
  it('rejects duplicate roles, a different account and expired admission', async () => {
    const fixture = await setup();
    const host = inbox((await fixture.join('host')).webSocket!);
    try {
      expect((await fixture.join('host')).status).toBe(403);
      expect((await fixture.join('phone', { ownerId: crypto.randomUUID() })).status).toBe(403);
      expect((await fixture.join('phone', { admissionExpiresAt: Date.now() - 1 })).status).toBe(403);
    } finally { host.socket.close(); }
  });
  it('rejects binary data before the private-key proof', async () => {
    const fixture = await setup();
    const phone = inbox((await fixture.join('phone')).webSocket!);
    phone.socket.send(new Uint8Array([0, 0, 0, 0, 0, 1]));
    await phone.closed;
    expect(phone.socket.readyState).not.toBe(1);
  });
  it('forwards a batched 128 KiB carrier frame to reduce relay message overhead', async () => {
    const fixture = await setup();
    const host = inbox((await fixture.join('host')).webSocket!);
    const phone = inbox((await fixture.join('phone')).webSocket!);
    try {
      const hostChallenge = await host.next(), phoneChallenge = await phone.next();
      host.socket.send(JSON.stringify({ type: 'proof', signature: await sign(hostChallenge, fixture.host.keys.privateKey) }));
      phone.socket.send(JSON.stringify({ type: 'proof', signature: await sign(phoneChallenge, fixture.phone.keys.privateKey) }));
      await host.next();
      await phone.next();
      const frame = new Uint8Array(128 * 1024);
      frame[0] = 0;
      phone.socket.send(frame);
      expect(new Uint8Array(await host.next())).toEqual(frame);
    } finally { host.socket.close(); phone.socket.close(); }
  });
});
