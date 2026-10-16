const assert = require('node:assert/strict');

const configuredUrl = process.env.AETHER_ACCOUNT_RELAY_URL;
delete process.env.AETHER_ACCOUNT_RELAY_URL;
delete require.cache[require.resolve('../lib/account/config.cjs')];

const defaultConfig = require('../lib/account/config.cjs');
const relayUrl = new URL(defaultConfig.relayUrl);

assert.equal(relayUrl.protocol, 'wss:');
assert.equal(relayUrl.hostname, 'aether-account-relay.akulenoklaha.workers.dev');
assert.equal(relayUrl.username, '');
assert.equal(relayUrl.password, '');
assert.equal(relayUrl.search, '');
assert.equal(relayUrl.hash, '');

if (configuredUrl === undefined) delete process.env.AETHER_ACCOUNT_RELAY_URL;
else process.env.AETHER_ACCOUNT_RELAY_URL = configuredUrl;

console.log('account config: production relay default is safe');
