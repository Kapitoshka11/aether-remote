const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { createWakeRelayApi } = require('../lib/wake/relay-api.cjs');

async function run() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 201, json: async () => ({ status: 'ok' }) };
  };
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const identity = {
    deviceId: '11'.repeat(16),
    publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
  const group = {
    groupId: '22'.repeat(16),
    ownerDeviceId: identity.deviceId,
    ownerPublicKeySpki: keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    relayUrl: 'https://relay.example'
  };
  const api = createWakeRelayApi({ fetchImpl, identity, clock: () => 1_700_000_000_000, randomBytesImpl: () => Buffer.alloc(16, 0xaa) });

  assert.deepEqual(await api.registerGroup(group), { ok: true, status: 201 });
  assert.equal(calls[0].url, 'https://relay.example/v1/groups');
  assert.equal(calls[0].body.type, 'wake.group.register');
  assert.equal(calls[0].body.expiresAt - calls[0].body.issuedAt, 30_000);

  const certificate = { groupId: group.groupId, deviceId: '33'.repeat(16), type: 'wake.membership' };
  assert.deepEqual(await api.enrollMember(group, certificate), { ok: true, status: 201 });
  assert.equal(calls[1].url, `https://relay.example/v1/groups/${group.groupId}/members`);
  assert.deepEqual(calls[1].body, certificate);

  assert.deepEqual(await api.revokeMember(group, certificate.deviceId), { ok: true, status: 201 });
  assert.equal(calls[2].url, `https://relay.example/v1/groups/${group.groupId}/revoke`);
  assert.equal(calls[2].body.type, 'wake.member.revoke');

  const failed = createWakeRelayApi({
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_membership' }) }),
    identity
  });
  assert.deepEqual(await failed.enrollMember(group, certificate), { ok: false, status: 401, code: 'invalid_membership' });

  console.log('Wake Relay API tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
