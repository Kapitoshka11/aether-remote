const assert = require('node:assert/strict');
const { normalizeTokenInfo, decideApproval, handleAuthAttempt } = require('../lib/auth-policy.cjs');

const now = 1_700_000_000_000;
const ttl = 30 * 24 * 60 * 60 * 1000;

assert.deepEqual(normalizeTokenInfo(null, now, ttl), {
  issuedAt: now,
  expiresAt: now + ttl,
  trusted: false,
  deviceName: 'Aether mobile client',
  ipAddress: ''
});
assert.equal(normalizeTokenInfo({ issuedAt: 10, expiresAt: 20 }, now, ttl).trusted, false);
assert.equal(normalizeTokenInfo({ trusted: true, deviceName: 'Pixel', ipAddress: '192.168.1.2' }, now, ttl).trusted, true);

assert.equal(decideApproval({ credentialValid: false, tokenTrusted: false }), 'reject');
assert.equal(decideApproval({ credentialValid: true, tokenTrusted: false }), 'prompt');
assert.equal(decideApproval({ credentialValid: true, tokenTrusted: true }), 'approve-now');

const failures = new Map();
const authenticate = (pin, token) => {
  if (token === 'valid-token') return { success: true, token, trusted: true };
  if (pin === 'correct-pin') return { success: true, token: 'new-token', isNewToken: true };
  return { success: false, reason: token ? 'Session token has expired' : 'Incorrect PIN or pairing code' };
};

for (let attempt = 0; attempt < 10; attempt += 1) {
  const result = handleAuthAttempt({
    identifier: '192.168.1.2', enteredPin: '', passedToken: 'expired-token', failures, authenticate, now: 1_000 + attempt
  });
  assert.equal(result.success, false);
  assert.equal(result.isBlocked, false);
}
assert.equal(failures.has('192.168.1.2'), false);

for (let attempt = 0; attempt < 3; attempt += 1) {
  handleAuthAttempt({
    identifier: '192.168.1.2', enteredPin: 'wrong-pin', passedToken: '', failures, authenticate, now: 2_000 + attempt
  });
}
assert.equal(failures.get('192.168.1.2').count, 3);
assert.equal(handleAuthAttempt({
  identifier: '192.168.1.2', enteredPin: '', passedToken: 'expired-token', failures, authenticate, now: 3_000
}).isBlocked, false);

console.log('Authentication policy tests passed.');
