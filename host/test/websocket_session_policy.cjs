const assert = require('node:assert/strict');
const {
  MAX_CONTROL_CONNECTIONS,
  MAX_PREAUTH_CONNECTIONS,
  isGuestSessionActive,
  scheduleAbsoluteExpiry,
  connectionAdmission
} = require('../lib/websocket-session-policy.cjs');

const now = Date.now();
const tokens = new Map([
  ['active', { expiresAt: now + 1_000 }],
  ['expired', { expiresAt: now - 1 }]
]);
assert.equal(isGuestSessionActive({ isAuth: true, sessionToken: 'active' }, tokens, now), true);
assert.equal(isGuestSessionActive({ isAuth: true, sessionToken: 'expired' }, tokens, now), false);
assert.equal(isGuestSessionActive({ isAuth: true, accountAuthentication: true }, tokens, now), true);

assert.equal(connectionAdmission(Array.from({ length: MAX_CONTROL_CONNECTIONS }, () => ({ isAuth: true }))).totalAllowed, true);
assert.equal(connectionAdmission(Array.from({ length: MAX_CONTROL_CONNECTIONS + 1 }, () => ({ isAuth: true }))).totalAllowed, false);
assert.equal(connectionAdmission(Array.from({ length: MAX_PREAUTH_CONNECTIONS + 1 }, () => ({ isAuth: false }))).preauthAllowed, false);

let callback = null;
let cleared = false;
const timers = {
  setTimeout(fn) { callback = fn; return 1; },
  clearTimeout() { cleared = true; }
};
const cancel = scheduleAbsoluteExpiry(now - 1, () => { callback = 'expired'; }, timers);
assert.equal(callback, 'expired');
cancel();
assert.equal(cleared, false);

console.log('WebSocket session policy tests passed.');
