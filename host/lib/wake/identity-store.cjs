const fs = require('node:fs');
const path = require('node:path');
const { generateKeyPairSync, randomBytes } = require('node:crypto');

function isIdentity(value) {
  return value
    && value.version === 1
    && /^[0-9a-f]{32}$/.test(value.deviceId)
    && typeof value.publicKeyPem === 'string'
    && value.publicKeyPem.includes('BEGIN PUBLIC KEY')
    && typeof value.privateKeyPem === 'string'
    && value.privateKeyPem.includes('BEGIN PRIVATE KEY');
}

function createIdentityStore({ filePath, safeStorage, fsImpl = fs }) {
  function loadOrCreate() {
    if (!safeStorage?.isEncryptionAvailable?.()) return { ok: false, code: 'encryption_unavailable' };
    if (fsImpl.existsSync(filePath)) {
      try {
        const decrypted = safeStorage.decryptString(fsImpl.readFileSync(filePath));
        const identity = JSON.parse(decrypted);
        return isIdentity(identity) ? { ok: true, identity } : { ok: false, code: 'identity_corrupt' };
      } catch {
        return { ok: false, code: 'identity_corrupt' };
      }
    }

    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const identity = {
      version: 1,
      deviceId: randomBytes(16).toString('hex'),
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
    };
    const encrypted = safeStorage.encryptString(JSON.stringify(identity));
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fsImpl.writeFileSync(temporaryPath, encrypted, { flag: 'wx' });
      fsImpl.renameSync(temporaryPath, filePath);
    } finally {
      if (fsImpl.existsSync(temporaryPath)) fsImpl.unlinkSync(temporaryPath);
    }
    return { ok: true, identity };
  }

  return { loadOrCreate };
}

module.exports = { createIdentityStore };
