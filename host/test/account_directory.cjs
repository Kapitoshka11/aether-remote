const assert = require('node:assert/strict');
const { parseDevice } = require('../lib/account/directory-client.cjs');
const { createIdentity } = require('../lib/account/protocol.cjs');

const ownerId = '11111111-1111-4111-8111-111111111111';
const identity = createIdentity();
const base = {
  owner_id: ownerId,
  id: identity.id,
  kind: 'host',
  name: 'VPN host',
  public_key_spki: identity.publicKeySpki,
  tls_fingerprint: 'a'.repeat(64),
  lan_ip: '192.168.1.20',
  port: 8080,
  last_seen_at: '2026-10-14T00:00:00Z',
  revoked_at: null
};

const parsed = parseDevice({
  ...base,
  network_endpoints: ['192.168.1.20', '100.84.2.10', '172.19.0.1']
});
assert.deepEqual(parsed.networkEndpoints, ['192.168.1.20', '100.84.2.10', '172.19.0.1']);
assert.throws(() => parseDevice({ ...base, network_endpoints: ['127.0.0.1'] }), /invalid_account_device/);
assert.throws(() => parseDevice({ ...base, network_endpoints: Array(17).fill('10.0.0.1') }), /invalid_account_device/);

console.log('account directory: LAN and VPN endpoint validation passed');
