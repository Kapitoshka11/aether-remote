const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createIdentityStore } = require('../lib/wake/identity-store.cjs');

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8').reverse(),
  decryptString: value => Buffer.from(value).reverse().toString('utf8')
};

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-wake-identity-'));
const filePath = path.join(directory, 'wake-identity.dat');

try {
  const store = createIdentityStore({ filePath, safeStorage });
  const created = store.loadOrCreate();
  assert.equal(created.ok, true);
  assert.match(created.identity.deviceId, /^[0-9a-f]{32}$/);
  assert.match(created.identity.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.match(created.identity.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.equal(fs.readFileSync(filePath).includes(Buffer.from('PRIVATE KEY')), false);

  const loaded = store.loadOrCreate();
  assert.deepEqual(loaded, created);

  fs.writeFileSync(filePath, Buffer.from('corrupt'));
  const corruptBytes = fs.readFileSync(filePath);
  assert.deepEqual(store.loadOrCreate(), { ok: false, code: 'identity_corrupt' });
  assert.deepEqual(fs.readFileSync(filePath), corruptBytes);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log('Wake identity store tests passed.');
