const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync, randomBytes } = require('node:crypto');
const { createWakeGroupStore } = require('../lib/wake/group-store.cjs');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8').reverse(),
  decryptString: value => Buffer.from(value).reverse().toString('utf8')
};
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const identity = {
  deviceId: randomBytes(16).toString('hex'),
  publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  privateKeyPem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
};
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-wake-group-'));
const filePath = path.join(directory, 'wake-group.dat');

try {
  const store = createWakeGroupStore({ filePath, safeStorage, ownerIdentity: identity });
  const created = store.createHomeGroup('https://relay.example.workers.dev');
  assert.equal(created.ok, true);
  assert.match(created.group.groupId, /^[0-9a-f]{32}$/);
  assert.equal(created.group.ownerDeviceId, identity.deviceId);
  assert.equal(created.group.relayUrl, 'https://relay.example.workers.dev');
  assert.equal(created.group.bridgeEnabled, true);
  assert.equal(fs.readFileSync(filePath).includes(Buffer.from(created.group.groupId)), false);
  assert.deepEqual(store.createHomeGroup('https://different.invalid'), created);
  assert.deepEqual(store.load(), created);

  assert.equal(store.registerTarget({ deviceId: '11112222333344445555666677778888', name: 'Gaming PC', mac: 'aa:bb:01:02:fe:ff' }).ok, true);
  assert.deepEqual(store.getTarget('11112222333344445555666677778888'), { deviceId: '11112222333344445555666677778888', name: 'Gaming PC', mac: 'aa:bb:01:02:fe:ff' });
  assert.equal(store.setBridgeEnabled(false).group.bridgeEnabled, false);
  const member = { groupId: created.group.groupId, deviceId: 'aa'.repeat(16), role: 'phone', publicKeySpki: 'key' };
  assert.equal(store.addMember(member).ok, true);
  assert.equal(store.removeMember(member.deviceId).ok, true);
  assert.equal(store.getMember(member.deviceId), null);

  fs.writeFileSync(filePath, Buffer.from('corrupt'));
  const bytes = fs.readFileSync(filePath);
  assert.deepEqual(store.load(), { ok: false, code: 'group_corrupt' });
  assert.deepEqual(fs.readFileSync(filePath), bytes);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('Wake group store tests passed.');
