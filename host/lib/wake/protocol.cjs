const WAKE_PROTOCOL_VERSION = 1;
const { createSign, createVerify } = require('node:crypto');
const IDENTIFIER_PATTERN = /^[0-9a-f]{32}$/;
const MEMBERSHIP_ROLES = new Set(['owner', 'phone', 'bridge', 'host']);
const ALLOWED_CLOCK_SKEW_MS = 10_000;

function canonicalizeWakeMessage(message) {
  return Buffer.from([
    `AETHER_WAKE/${WAKE_PROTOCOL_VERSION}`,
    `type=${message.type}`,
    `groupId=${message.groupId}`,
    `targetDeviceId=${message.targetDeviceId}`,
    `senderDeviceId=${message.senderDeviceId}`,
    `nonce=${message.nonce}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'), 'utf8');
}

function validateWakeRequest(message, nowMs) {
  if (!message || message.version !== WAKE_PROTOCOL_VERSION || message.type !== 'wake.request') {
    return { ok: false, code: 'invalid_version_or_type' };
  }
  if (![message.groupId, message.targetDeviceId, message.senderDeviceId, message.nonce]
    .every(value => typeof value === 'string' && IDENTIFIER_PATTERN.test(value))) {
    return { ok: false, code: 'invalid_identifier' };
  }
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)) {
    return { ok: false, code: 'invalid_time' };
  }
  const ttl = message.expiresAt - message.issuedAt;
  if (ttl < 1 || ttl > 30_000) return { ok: false, code: 'invalid_ttl' };
  if (!Number.isSafeInteger(nowMs)) return { ok: false, code: 'invalid_time' };
  if (message.issuedAt > nowMs + ALLOWED_CLOCK_SKEW_MS) return { ok: false, code: 'future_issued_at' };
  if (nowMs - message.issuedAt > 30_000 + ALLOWED_CLOCK_SKEW_MS) return { ok: false, code: 'stale' };
  if (nowMs > message.expiresAt) return { ok: false, code: 'expired' };
  return { ok: true };
}

function createWakeRequest(fields, privateKeyPem) {
  const message = { ...fields, version: WAKE_PROTOCOL_VERSION, type: 'wake.request' };
  const validation = validateWakeRequest(message, message.issuedAt);
  if (!validation.ok) throw new Error(validation.code);
  const signer = createSign('SHA256');
  signer.update(canonicalizeWakeMessage(message));
  signer.end();
  return { ...message, signature: signer.sign(privateKeyPem).toString('base64') };
}

function verifyWakeRequest(message, publicKeyPem, nowMs) {
  if (!validateWakeRequest(message, nowMs).ok || typeof message.signature !== 'string') return false;
  try {
    const verifier = createVerify('SHA256');
    verifier.update(canonicalizeWakeMessage(message));
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(message.signature, 'base64'));
  } catch {
    return false;
  }
}

function canonicalizeMembershipCertificate(certificate) {
  return Buffer.from([
    `AETHER_WAKE_MEMBER/${WAKE_PROTOCOL_VERSION}`,
    `type=${certificate.type}`,
    `groupId=${certificate.groupId}`,
    `deviceId=${certificate.deviceId}`,
    `role=${certificate.role}`,
    `publicKeySpki=${certificate.publicKeySpki}`,
    `issuedAt=${certificate.issuedAt}`,
    `expiresAt=${certificate.expiresAt}`
  ].join('\n'), 'utf8');
}

function validateMembershipCertificate(certificate, nowMs) {
  if (!certificate || certificate.version !== WAKE_PROTOCOL_VERSION || certificate.type !== 'wake.membership') return false;
  if (!IDENTIFIER_PATTERN.test(certificate.groupId) || !IDENTIFIER_PATTERN.test(certificate.deviceId)) return false;
  if (!MEMBERSHIP_ROLES.has(certificate.role)) return false;
  if (typeof certificate.publicKeySpki !== 'string' || certificate.publicKeySpki.length < 32 || certificate.publicKeySpki.length > 2048) return false;
  if (!Number.isSafeInteger(certificate.issuedAt) || !Number.isSafeInteger(certificate.expiresAt)) return false;
  if (certificate.expiresAt <= certificate.issuedAt || nowMs > certificate.expiresAt) return false;
  return true;
}

function createMembershipCertificate(fields, ownerPrivateKeyPem) {
  const certificate = { ...fields, version: WAKE_PROTOCOL_VERSION, type: 'wake.membership' };
  if (!validateMembershipCertificate(certificate, certificate.issuedAt)) throw new Error('invalid_membership');
  const signer = createSign('SHA256');
  signer.update(canonicalizeMembershipCertificate(certificate));
  signer.end();
  return { ...certificate, signature: signer.sign(ownerPrivateKeyPem).toString('base64') };
}

function verifyMembershipCertificate(certificate, ownerPublicKeyPem, nowMs) {
  if (!validateMembershipCertificate(certificate, nowMs) || typeof certificate.signature !== 'string') return false;
  try {
    const verifier = createVerify('SHA256');
    verifier.update(canonicalizeMembershipCertificate(certificate));
    verifier.end();
    return verifier.verify(ownerPublicKeyPem, Buffer.from(certificate.signature, 'base64'));
  } catch {
    return false;
  }
}

function canonicalizeGroupRegistration(message) {
  return Buffer.from([
    `AETHER_WAKE_GROUP/${WAKE_PROTOCOL_VERSION}`,
    'type=wake.group.register',
    `groupId=${message.groupId}`,
    `ownerDeviceId=${message.ownerDeviceId}`,
    `ownerPublicKeySpki=${message.ownerPublicKeySpki}`,
    `nonce=${message.nonce}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'), 'utf8');
}

function canonicalizeMemberRevocation(message) {
  return Buffer.from([
    `AETHER_WAKE_REVOKE/${WAKE_PROTOCOL_VERSION}`,
    'type=wake.member.revoke',
    `groupId=${message.groupId}`,
    `ownerDeviceId=${message.ownerDeviceId}`,
    `deviceId=${message.deviceId}`,
    `nonce=${message.nonce}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'), 'utf8');
}

function validateShortLivedOwnerMessage(message, nowMs, identifiers) {
  if (!message || message.version !== WAKE_PROTOCOL_VERSION) return false;
  if (!identifiers.every(value => typeof value === 'string' && IDENTIFIER_PATTERN.test(value))) return false;
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)) return false;
  const ttl = message.expiresAt - message.issuedAt;
  return ttl >= 1 && ttl <= 30_000 && nowMs <= message.expiresAt
    && message.issuedAt <= nowMs + ALLOWED_CLOCK_SKEW_MS
    && nowMs - message.issuedAt <= 30_000 + ALLOWED_CLOCK_SKEW_MS;
}

function signCanonical(message, canonicalize, privateKeyPem) {
  const signer = createSign('SHA256');
  signer.update(canonicalize(message));
  signer.end();
  return { ...message, signature: signer.sign(privateKeyPem).toString('base64') };
}

function verifyCanonical(message, canonicalize, publicKeyPem) {
  if (typeof message.signature !== 'string') return false;
  try {
    const verifier = createVerify('SHA256');
    verifier.update(canonicalize(message));
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(message.signature, 'base64'));
  } catch {
    return false;
  }
}

function createGroupRegistration(fields, ownerPrivateKeyPem) {
  const message = { ...fields, version: WAKE_PROTOCOL_VERSION, type: 'wake.group.register' };
  if (!validateShortLivedOwnerMessage(message, message.issuedAt, [message.groupId, message.ownerDeviceId, message.nonce])
    || typeof message.ownerPublicKeySpki !== 'string' || message.ownerPublicKeySpki.length > 2048) {
    throw new Error('invalid_group_registration');
  }
  return signCanonical(message, canonicalizeGroupRegistration, ownerPrivateKeyPem);
}

function verifyGroupRegistration(message, ownerPublicKeyPem, nowMs) {
  return message?.type === 'wake.group.register'
    && typeof message.ownerPublicKeySpki === 'string'
    && message.ownerPublicKeySpki.length <= 2048
    && validateShortLivedOwnerMessage(message, nowMs, [message.groupId, message.ownerDeviceId, message.nonce])
    && verifyCanonical(message, canonicalizeGroupRegistration, ownerPublicKeyPem);
}

function createMemberRevocation(fields, ownerPrivateKeyPem) {
  const message = { ...fields, version: WAKE_PROTOCOL_VERSION, type: 'wake.member.revoke' };
  if (!validateShortLivedOwnerMessage(message, message.issuedAt, [message.groupId, message.ownerDeviceId, message.deviceId, message.nonce])) {
    throw new Error('invalid_member_revocation');
  }
  return signCanonical(message, canonicalizeMemberRevocation, ownerPrivateKeyPem);
}

function verifyMemberRevocation(message, ownerPublicKeyPem, nowMs) {
  return message?.type === 'wake.member.revoke'
    && validateShortLivedOwnerMessage(message, nowMs, [message.groupId, message.ownerDeviceId, message.deviceId, message.nonce])
    && verifyCanonical(message, canonicalizeMemberRevocation, ownerPublicKeyPem);
}

module.exports = {
  WAKE_PROTOCOL_VERSION,
  canonicalizeWakeMessage,
  validateWakeRequest,
  createWakeRequest,
  verifyWakeRequest,
  canonicalizeMembershipCertificate,
  createMembershipCertificate,
  verifyMembershipCertificate,
  canonicalizeGroupRegistration,
  createGroupRegistration,
  verifyGroupRegistration,
  canonicalizeMemberRevocation,
  createMemberRevocation,
  verifyMemberRevocation
};
