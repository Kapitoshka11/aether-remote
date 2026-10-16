const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSecureStore, loadIdentity } = require('../lib/account/secure-store.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-account-test-'));
  const filePath = path.join(directory, 'account.bin');
  const key = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    },
    decryptString(bytes) {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    }
  };
  try {
    let store = await createSecureStore({ filePath, safeStorage });
    const identity = await loadIdentity(store);
    await Promise.all(Array.from({ length: 12 }, (_, i) => store.setItem(`item-${i}`, `secret-${i}`)));
    assert.equal((await fs.readFile(filePath)).includes(Buffer.from('secret-')), false);
    assert.equal((await fs.readFile(filePath)).includes(Buffer.from('PRIVATE KEY')), false);
    store = await createSecureStore({ filePath, safeStorage });
    assert.deepEqual(await loadIdentity(store), identity);
    for (let i = 0; i < 12; i++) assert.equal(await store.getItem(`item-${i}`), `secret-${i}`);
    await store.removeItem('item-2');
    assert.equal(await store.getItem('item-2'), null);
    await assert.rejects(store.setItem('bad/key', 'secret'));
    await fs.writeFile(filePath, 'corrupt');
    await assert.rejects(createSecureStore({ filePath, safeStorage }), /account_store_unreadable/);
    const volatile = await createSecureStore({ filePath, safeStorage: { isEncryptionAvailable: () => false } });
    assert.equal(volatile.persistent, false);
    await volatile.setItem('token', 'in-memory-only');
    assert.equal(await fs.readFile(filePath, 'utf8'), 'corrupt');
    console.log('account storage: encrypted persistence, concurrent writes, identity, corruption and memory fallback passed');
  } finally {
    for (const name of await fs.readdir(directory)) await fs.unlink(path.join(directory, name));
    await fs.rmdir(directory);
  }
})().catch(() => { console.error('account storage test failed'); process.exitCode = 1; });
