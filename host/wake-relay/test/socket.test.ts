import { describe, expect, it } from 'vitest';
import {
  connectMember,
  connectMemberResponse,
  createCertificate,
  enrollMember,
  nextMessage,
  registerGroup,
  signedWake
} from './relay-fixtures';

describe('wake relay sockets', () => {
  it('routes one valid request to a bridge and rejects its replay', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const phoneId = crypto.randomUUID().replaceAll('-', '');
    const bridgeId = crypto.randomUUID().replaceAll('-', '');
    const targetId = crypto.randomUUID().replaceAll('-', '');
    const keyOptions = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const ownerKeys = await crypto.subtle.generateKey(keyOptions, true, ['sign', 'verify']);
    const phoneKeys = await crypto.subtle.generateKey(keyOptions, true, ['sign', 'verify']);
    const bridgeKeys = await crypto.subtle.generateKey(keyOptions, true, ['sign', 'verify']);
    expect((await registerGroup(groupId, ownerId, ownerKeys, now)).status).toBe(201);
    const phoneCertificate = await createCertificate(groupId, phoneId, 'phone', phoneKeys, ownerKeys, now);
    const bridgeCertificate = await createCertificate(groupId, bridgeId, 'bridge', bridgeKeys, ownerKeys, now);
    expect((await enrollMember(groupId, phoneCertificate)).status).toBe(201);
    expect((await enrollMember(groupId, bridgeCertificate)).status).toBe(201);

    const phone = await connectMember(groupId, phoneId, phoneCertificate);
    const bridge = await connectMember(groupId, bridgeId, bridgeCertificate);
    const request = await signedWake(groupId, phoneId, targetId, phoneKeys, now);
    const bridgeMessage = nextMessage(bridge);
    phone.send(JSON.stringify(request));
    expect(await bridgeMessage).toEqual(request);

    const deliveryMessage = nextMessage(phone);
    bridge.send(JSON.stringify({ version: 1, type: 'wake.delivery', nonce: request.nonce, targetDeviceId: targetId, status: 'delivered', deliveredAt: now + 500 }));
    expect(await deliveryMessage).toMatchObject({ type: 'wake.delivery', nonce: request.nonce, status: 'delivered' });

    const replayError = nextMessage(phone);
    phone.send(JSON.stringify(request));
    expect(await replayError).toMatchObject({ type: 'error', code: 'replay', nonce: request.nonce });

    const onlineMessage = nextMessage(phone);
    bridge.send(JSON.stringify({ version: 1, type: 'host.online', deviceId: targetId, onlineAt: now + 1_000 }));
    expect(await onlineMessage).toMatchObject({ type: 'host.online', deviceId: targetId });

    phone.close(1000, 'test_complete');
    bridge.close(1000, 'test_complete');
  });

  it('returns no_bridge when no bridge is connected', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const phoneId = crypto.randomUUID().replaceAll('-', '');
    const targetId = crypto.randomUUID().replaceAll('-', '');
    const options = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const ownerKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    const phoneKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    await registerGroup(groupId, ownerId, ownerKeys, now);
    const certificate = await createCertificate(groupId, phoneId, 'phone', phoneKeys, ownerKeys, now);
    await enrollMember(groupId, certificate);
    const phone = await connectMember(groupId, phoneId, certificate);
    const request = await signedWake(groupId, phoneId, targetId, phoneKeys, now);
    const errorMessage = nextMessage(phone);
    phone.send(JSON.stringify(request));
    expect(await errorMessage).toMatchObject({ type: 'error', code: 'no_bridge', nonce: request.nonce });
    phone.close(1000, 'test_complete');
  });

  it('rate-limits repeated wake requests from one phone', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const phoneId = crypto.randomUUID().replaceAll('-', '');
    const bridgeId = crypto.randomUUID().replaceAll('-', '');
    const targetId = crypto.randomUUID().replaceAll('-', '');
    const options = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const ownerKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    const phoneKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    const bridgeKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    await registerGroup(groupId, ownerId, ownerKeys, now);
    const phoneCertificate = await createCertificate(groupId, phoneId, 'phone', phoneKeys, ownerKeys, now);
    const bridgeCertificate = await createCertificate(groupId, bridgeId, 'bridge', bridgeKeys, ownerKeys, now);
    await enrollMember(groupId, phoneCertificate);
    await enrollMember(groupId, bridgeCertificate);
    const phone = await connectMember(groupId, phoneId, phoneCertificate);
    const bridge = await connectMember(groupId, bridgeId, bridgeCertificate);

    for (let index = 0; index < 10; index += 1) {
      const request = await signedWake(groupId, phoneId, targetId, phoneKeys, now);
      const routed = nextMessage(bridge);
      phone.send(JSON.stringify(request));
      expect(await routed).toMatchObject({ type: 'wake.request', nonce: request.nonce });
    }
    const blocked = await signedWake(groupId, phoneId, targetId, phoneKeys, now);
    const error = nextMessage(phone);
    phone.send(JSON.stringify(blocked));
    expect(await error).toMatchObject({ type: 'error', code: 'rate_limited', nonce: blocked.nonce });
    phone.close(1000, 'test_complete');
    bridge.close(1000, 'test_complete');
  });

  it('rate-limits repeated host presence messages from one bridge', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const bridgeId = crypto.randomUUID().replaceAll('-', '');
    const targetId = crypto.randomUUID().replaceAll('-', '');
    const options = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const ownerKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    const bridgeKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    await registerGroup(groupId, ownerId, ownerKeys, now);
    const bridgeCertificate = await createCertificate(groupId, bridgeId, 'bridge', bridgeKeys, ownerKeys, now);
    await enrollMember(groupId, bridgeCertificate);
    const bridge = await connectMember(groupId, bridgeId, bridgeCertificate);

    for (let index = 0; index < 60; index += 1) {
      bridge.send(JSON.stringify({ version: 1, type: 'host.online', deviceId: targetId, onlineAt: now + index }));
    }
    const error = nextMessage(bridge);
    bridge.send(JSON.stringify({ version: 1, type: 'host.online', deviceId: targetId, onlineAt: now + 60 }));
    expect(await error).toMatchObject({ type: 'error', code: 'rate_limited' });
    bridge.close(1000, 'test_complete');
  });

  it('rejects a valid certificate issued for a different home group', async () => {
    const now = Date.now();
    const groupId = crypto.randomUUID().replaceAll('-', '');
    const otherGroupId = crypto.randomUUID().replaceAll('-', '');
    const ownerId = crypto.randomUUID().replaceAll('-', '');
    const phoneId = crypto.randomUUID().replaceAll('-', '');
    const options = { name: 'ECDSA', namedCurve: 'P-256' } as const;
    const ownerKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    const phoneKeys = await crypto.subtle.generateKey(options, true, ['sign', 'verify']);
    await registerGroup(groupId, ownerId, ownerKeys, now);
    const enrolled = await createCertificate(groupId, phoneId, 'phone', phoneKeys, ownerKeys, now);
    await enrollMember(groupId, enrolled);
    const wrongGroup = await createCertificate(otherGroupId, phoneId, 'phone', phoneKeys, ownerKeys, now);

    expect((await connectMemberResponse(groupId, phoneId, wrongGroup)).status).toBe(401);
  });
});
