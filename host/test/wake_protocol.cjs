const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const {
  canonicalizeWakeMessage,
  createGroupRegistration,
  createMemberRevocation,
  createMembershipCertificate,
  createWakeRequest,
  validateWakeRequest,
  verifyMembershipCertificate,
  verifyWakeRequest,
  verifyGroupRegistration,
  verifyMemberRevocation
} = require('../lib/wake/protocol.cjs');

const request = {
  version: 1,
  type: 'wake.request',
  groupId: '00112233445566778899aabbccddeeff',
  targetDeviceId: '11112222333344445555666677778888',
  senderDeviceId: '9999aaaabbbbccccddddeeeeffff0000',
  nonce: '0123456789abcdeffedcba9876543210',
  issuedAt: 1_700_000_000_000,
  expiresAt: 1_700_000_030_000
};

const expected = [
  'AETHER_WAKE/1',
  'type=wake.request',
  'groupId=00112233445566778899aabbccddeeff',
  'targetDeviceId=11112222333344445555666677778888',
  'senderDeviceId=9999aaaabbbbccccddddeeeeffff0000',
  'nonce=0123456789abcdeffedcba9876543210',
  'issuedAt=1700000000000',
  'expiresAt=1700000030000'
].join('\n');

assert.equal(canonicalizeWakeMessage(request).toString('utf8'), expected);

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const signed = createWakeRequest(request, privateKeyPem);

assert.deepEqual(validateWakeRequest(signed, request.issuedAt), { ok: true });
assert.equal(verifyWakeRequest(signed, publicKeyPem, request.issuedAt), true);
assert.equal(verifyWakeRequest({ ...signed, targetDeviceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, publicKeyPem, request.issuedAt), false);
assert.deepEqual(validateWakeRequest(signed, request.expiresAt + 1), { ok: false, code: 'expired' });
assert.deepEqual(validateWakeRequest({ ...request, expiresAt: request.issuedAt + 30_001 }, request.issuedAt), { ok: false, code: 'invalid_ttl' });
assert.deepEqual(validateWakeRequest({ ...request, nonce: request.nonce.toUpperCase() }, request.issuedAt), { ok: false, code: 'invalid_identifier' });
assert.deepEqual(validateWakeRequest({ ...request, issuedAt: request.issuedAt + 60_000, expiresAt: request.issuedAt + 90_000 }, request.issuedAt), { ok: false, code: 'future_issued_at' });

const memberKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const memberPublicKeySpki = memberKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const certificate = createMembershipCertificate({
  version: 1,
  type: 'wake.membership',
  groupId: request.groupId,
  deviceId: request.senderDeviceId,
  role: 'phone',
  publicKeySpki: memberPublicKeySpki,
  issuedAt: request.issuedAt,
  expiresAt: request.issuedAt + 31_536_000_000
}, privateKeyPem);

assert.equal(verifyMembershipCertificate(certificate, publicKeyPem, request.issuedAt), true);
assert.equal(verifyMembershipCertificate({ ...certificate, role: 'bridge' }, publicKeyPem, request.issuedAt), false);
assert.equal(verifyMembershipCertificate(certificate, publicKeyPem, certificate.expiresAt + 1), false);

const registration = createGroupRegistration({
  groupId: request.groupId,
  ownerDeviceId: request.senderDeviceId,
  ownerPublicKeySpki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  nonce: request.nonce,
  issuedAt: request.issuedAt,
  expiresAt: request.issuedAt + 30_000
}, privateKeyPem);
assert.equal(verifyGroupRegistration(registration, publicKeyPem, request.issuedAt), true);
assert.equal(verifyGroupRegistration({ ...registration, groupId: 'aa'.repeat(16) }, publicKeyPem, request.issuedAt), false);

const revocation = createMemberRevocation({
  groupId: request.groupId,
  ownerDeviceId: request.senderDeviceId,
  deviceId: 'aa'.repeat(16),
  nonce: 'bb'.repeat(16),
  issuedAt: request.issuedAt,
  expiresAt: request.issuedAt + 30_000
}, privateKeyPem);
assert.equal(verifyMemberRevocation(revocation, publicKeyPem, request.issuedAt), true);
assert.equal(verifyMemberRevocation({ ...revocation, deviceId: 'cc'.repeat(16) }, publicKeyPem, request.issuedAt), false);

console.log('Wake protocol tests passed.');
