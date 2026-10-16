const assert = require('node:assert/strict');
const { selectWakeRoute } = require('../lib/wake/route.cjs');

assert.deepEqual(selectWakeRoute([
  { kind: 'direct_udp', status: 'available' },
  { kind: 'bridge', status: 'available' },
  { kind: 'router', status: 'available' }
]), { kind: 'bridge', status: 'available' });
assert.deepEqual(selectWakeRoute([
  { kind: 'bridge', status: 'temporarily_unavailable' },
  { kind: 'direct_udp', status: 'available' },
  { kind: 'router', status: 'available' }
]), { kind: 'router', status: 'available' });
assert.equal(selectWakeRoute([{ kind: 'bridge', status: 'needs_setup' }]), null);

console.log('Wake route selection tests passed.');
