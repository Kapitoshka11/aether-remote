const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createIdentity, deviceId } = require('./protocol.cjs');

async function createSecureStore({ filePath, safeStorage }) {
  const persistent = Boolean(safeStorage?.isEncryptionAvailable?.());
  let values = Object.create(null);
  let queue = Promise.resolve();
  if (persistent) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 4 * 1024 * 1024) throw new Error('account_store_too_large');
      const parsed = JSON.parse(safeStorage.decryptString(await fs.readFile(filePath)));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
          Object.entries(parsed).some(([key, value]) => !validKey(key) || typeof value !== 'string')) {
        throw new Error('account_store_corrupt');
      }
      values = Object.assign(Object.create(null), parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('account_store_unreadable');
    }
  }
  function validKey(key) { return typeof key === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(key); }
  function mutate(key, value) {
    if (!validKey(key) || (value !== null && (typeof value !== 'string' || value.length > 2 * 1024 * 1024))) {
      return Promise.reject(new Error('invalid_account_storage_value'));
    }
    const operation = queue.then(async () => {
      const next = Object.assign(Object.create(null), values);
      if (value === null) delete next[key]; else next[key] = value;
      const json = JSON.stringify(next);
      if (Buffer.byteLength(json) > 3 * 1024 * 1024) throw new Error('account_store_full');
      if (persistent) {
        const encrypted = safeStorage.encryptString(json);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temporary = `${filePath}.${crypto.randomBytes(12).toString('hex')}.tmp`;
        try {
          const handle = await fs.open(temporary, 'wx', 0o600);
          try { await handle.writeFile(encrypted); await handle.sync(); } finally { await handle.close(); }
          await fs.rename(temporary, filePath);
        } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
      values = next;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    persistent,
    async getItem(key) { await queue; return values[key] ?? null; },
    setItem: (key, value) => mutate(key, value),
    removeItem: key => mutate(key, null)
  };
}

async function loadIdentity(store) {
  const raw = await store.getItem('device-identity-v1');
  if (raw) {
    try {
      const identity = JSON.parse(raw);
      const derived = crypto.createPublicKey(identity.privateKeyPem).export({ format: 'der', type: 'spki' }).toString('base64');
      if (derived !== identity.publicKeySpki || deviceId(derived) !== identity.id) throw new Error();
      return Object.freeze(identity);
    } catch { throw new Error('account_identity_corrupt'); }
  }
  const identity = createIdentity();
  await store.setItem('device-identity-v1', JSON.stringify(identity));
  return Object.freeze(identity);
}

module.exports = { createSecureStore, loadIdentity };
