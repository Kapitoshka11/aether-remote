const crypto = require('node:crypto');
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;

function publicKey(spki) {
  if (typeof spki !== 'string' || !/^[A-Za-z0-9+/]{122}==$/.test(spki)) throw new Error('invalid_device_key');
  const bytes = Buffer.from(spki, 'base64');
  const key = crypto.createPublicKey({ key: bytes, format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1' ||
      key.export({ format: 'der', type: 'spki' }).toString('base64') !== spki) throw new Error('invalid_device_key');
  return key;
}

function deviceId(spki) {
  publicKey(spki);
  return crypto.createHash('sha256').update(Buffer.from(spki, 'base64')).digest('hex');
}

function createIdentity() {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeySpki = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { id: deviceId(publicKeySpki), publicKeySpki,
    privateKeyPem: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) };
}

function validateGrant(g) {
  if (!g || g.version !== 1 || !UUID.test(g.ownerId) || !UUID.test(g.grantId) ||
      !HEX.test(g.hostId) || !HEX.test(g.phoneId) || g.hostId === g.phoneId ||
      !HEX.test(g.hostTlsFingerprint) || !Number.isSafeInteger(g.issuedAt) || g.issuedAt <= 0 ||
      !Number.isInteger(g.revision) || g.revision < 1 || g.revision > 2147483647 ||
      g.permissions !== 'control' || deviceId(g.phonePublicKeySpki) !== g.phoneId) throw new Error('invalid_grant');
}

function canonicalGrant(g) {
  validateGrant(g);
  return Buffer.from(['AETHER_ACCOUNT_GRANT_V1', g.ownerId, g.hostId, g.phoneId,
    g.phonePublicKeySpki, g.hostTlsFingerprint, g.permissions, g.issuedAt, g.grantId, g.revision].join('\n'));
}

function signGrant(fields, key) {
  const g = { ...fields, version: 1, permissions: 'control' };
  const derived = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }).toString('base64');
  if (deviceId(derived) !== g.hostId) throw new Error('host_identity_mismatch');
  return { ...g, signature: crypto.sign('sha256', canonicalGrant(g), key).toString('base64url') };
}

function verifySignature(bytes, signature, spki) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{90,100}$/.test(signature)) return false;
  const raw = Buffer.from(signature, 'base64url');
  if (raw.toString('base64url') !== signature) return false;
  return crypto.verify('sha256', bytes, publicKey(spki), raw);
}

function verifyGrant(g, hostSpki) {
  try {
    return deviceId(hostSpki) === g.hostId && verifySignature(canonicalGrant(g), g.signature, hostSpki);
  } catch { return false; }
}

function canonicalProof(c) {
  if (!c || c.version !== 1 || !UUID.test(c.ownerId) || !UUID.test(c.grantId) || !UUID.test(c.sessionId) ||
      !HEX.test(c.hostId) || !HEX.test(c.phoneId) || !NONCE.test(c.nonce) ||
      Buffer.from(c.nonce, 'base64url').toString('base64url') !== c.nonce ||
      !['lan', 'relay'].includes(c.transport) || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= 0) {
    throw new Error('invalid_challenge');
  }
  return Buffer.from(['AETHER_ACCOUNT_AUTH_V1', c.ownerId, c.hostId, c.phoneId, c.sessionId,
    c.transport, c.grantId, c.nonce, c.expiresAt].join('\n'));
}

function signProof(challenge, key) {
  return { ...challenge, signature: crypto.sign('sha256', canonicalProof(challenge), key).toString('base64url') };
}

// One instance belongs to one socket; it never maintains an unbounded global nonce cache.
class AuthChallenge {
  constructor({ now = Date.now, isAllowed }) {
    this.now = now;
    this.isAllowed = isAllowed;
    this.pending = null;
  }
  issue(grant, sessionId, transport) {
    this.clear();
    validateGrant(grant);
    if (!this.isAllowed(grant)) throw new Error('device_not_trusted');
    const challenge = { version: 1, ownerId: grant.ownerId, hostId: grant.hostId,
      phoneId: grant.phoneId, grantId: grant.grantId, sessionId, transport,
      nonce: crypto.randomBytes(32).toString('base64url'), expiresAt: this.now() + 30000 };
    canonicalProof(challenge);
    this.pending = { grant: { ...grant }, challenge };
    return { ...challenge };
  }
  verify(proof) {
    const pending = this.pending;
    this.clear();
    try {
      if (!pending || this.now() >= pending.challenge.expiresAt || !this.isAllowed(pending.grant)) return false;
      const expected = canonicalProof(pending.challenge);
      return canonicalProof(proof).equals(expected) &&
        verifySignature(expected, proof.signature, pending.grant.phonePublicKeySpki);
    } catch { return false; }
  }
  clear() { this.pending = null; }
}

module.exports = { publicKey, deviceId, createIdentity, validateGrant, canonicalGrant, signGrant,
  verifyGrant, canonicalProof, signProof, AuthChallenge };
