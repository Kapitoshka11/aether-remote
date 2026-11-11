const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { createWakeRequest } = require('../lib/wake/protocol.cjs');
const { createWakeBridge } = require('../lib/wake/bridge.cjs');

async function run() {
  const now = 1_700_000_000_000;
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const fields = {
    groupId: '00112233445566778899aabbccddeeff',
    targetDeviceId: '11112222333344445555666677778888',
    senderDeviceId: '9999aaaabbbbccccddddeeeeffff0000',
    nonce: '0123456789abcdeffedcba9876543210',
    issuedAt: now,
    expiresAt: now + 30_000
  };
  const signed = createWakeRequest(fields, privateKeyPem);
  const sent = [];
  const seen = new Set();
  const dependencies = {
    enabled: () => true,
    groupId: fields.groupId,
    memberStore: { getPublicKey: deviceId => deviceId === fields.senderDeviceId ? publicKeyPem : null },
    targetStore: { get: deviceId => deviceId === fields.targetDeviceId ? { mac: 'aa:bb:01:02:fe:ff' } : null },
    udpSender: async mac => { sent.push(mac); },
    nonceStore: {
      has: nonce => seen.has(nonce),
      add: nonce => seen.add(nonce)
    },
    clock: () => now
  };

  const bridge = createWakeBridge(dependencies);
  assert.deepEqual(await bridge.deliver(signed), { status: 'delivered', code: 'sent', deliveredAt: now });
  assert.deepEqual(sent, ['aa:bb:01:02:fe:ff']);
  assert.deepEqual(await bridge.deliver(signed), { status: 'rejected', code: 'replay' });

  assert.deepEqual(
    await createWakeBridge({ ...dependencies, enabled: () => false }).deliver({ ...signed, nonce: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    { status: 'rejected', code: 'bridge_disabled' }
  );
  assert.deepEqual(
    await createWakeBridge(dependencies).deliver({ ...signed, targetDeviceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nonce: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
    { status: 'rejected', code: 'invalid_signature' }
  );
  assert.deepEqual(
    await createWakeBridge(dependencies).deliver(createWakeRequest({ ...fields, targetDeviceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', nonce: 'cccccccccccccccccccccccccccccccc' }, privateKeyPem)),
    { status: 'rejected', code: 'unknown_target' }
  );
  assert.deepEqual(
    await createWakeBridge({ ...dependencies, clock: () => now + 30_001 }).deliver({ ...signed, nonce: 'dddddddddddddddddddddddddddddddd' }),
    { status: 'rejected', code: 'expired' }
  );

  console.log('Wake Bridge tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
