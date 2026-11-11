const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const { createWakeGroupStore } = require('../lib/wake/group-store.cjs');
const { createWakeEnrollment } = require('../lib/wake/enrollment.cjs');
const { verifyMembershipCertificate } = require('../lib/wake/protocol.cjs');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8').reverse(),
  decryptString: value => Buffer.from(value).reverse().toString('utf8')
};
const ownerKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ownerIdentity = {
  deviceId: randomBytes(16).toString('hex'),
  publicKeyPem: ownerKeys.publicKey.export({ type: 'spki', format: 'pem' }),
  privateKeyPem: ownerKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })
};
const phoneKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const phoneId = randomBytes(16).toString('hex');
const phoneSpki = phoneKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-wake-enroll-'));

try {
  const groupStore = createWakeGroupStore({ filePath: path.join(directory, 'group.dat'), safeStorage, ownerIdentity });
  const group = groupStore.createHomeGroup('https://relay.example.workers.dev').group;
  const now = 1_700_000_000_000;
  const enrollment = createWakeEnrollment({ groupStore, ownerIdentity, clock: () => now });
  const result = enrollment.approve({ deviceId: phoneId, publicKeySpki: phoneSpki, role: 'phone' });

  assert.equal(result.ok, true);
  assert.equal(result.groupId, group.groupId);
  assert.equal(result.relayUrl, group.relayUrl);
  assert.equal(result.certificate.deviceId, phoneId);
  assert.equal(verifyMembershipCertificate(result.certificate, ownerIdentity.publicKeyPem, now), true);
  assert.match(groupStore.getMemberPublicKey(phoneId), /BEGIN PUBLIC KEY/);
  assert.deepEqual(enrollment.approve({ deviceId: phoneId, publicKeySpki: phoneSpki, role: 'phone' }), result);
  assert.deepEqual(enrollment.approve({ deviceId: phoneId, publicKeySpki: 'not-a-key', role: 'phone' }), { ok: false, code: 'invalid_public_key' });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('Wake enrollment tests passed.');
