const assert = require('node:assert/strict');

const prevUrl = process.env.AETHER_SUPABASE_URL;
const prevKey = process.env.AETHER_SUPABASE_PUBLISHABLE_KEY;
const prevRelay = process.env.AETHER_ACCOUNT_RELAY_URL;
delete process.env.AETHER_SUPABASE_URL;
delete process.env.AETHER_SUPABASE_PUBLISHABLE_KEY;
delete process.env.AETHER_ACCOUNT_RELAY_URL;
delete require.cache[require.resolve('../lib/account/config.cjs')];

const emptyConfig = require('../lib/account/config.cjs');
assert.equal(emptyConfig.url, '');
assert.equal(emptyConfig.publishableKey, '');
assert.equal(emptyConfig.relayUrl, '');

process.env.AETHER_SUPABASE_URL = 'https://project.example.supabase.co ';
process.env.AETHER_SUPABASE_PUBLISHABLE_KEY = ' public-client-key ';
process.env.AETHER_ACCOUNT_RELAY_URL = ' wss://relay.example.test ';
delete require.cache[require.resolve('../lib/account/config.cjs')];

const configured = require('../lib/account/config.cjs');
const relayUrl = new URL(configured.relayUrl);
assert.equal(configured.url, 'https://project.example.supabase.co');
assert.equal(configured.publishableKey, 'public-client-key');
assert.equal(relayUrl.protocol, 'wss:');
assert.equal(relayUrl.hostname, 'relay.example.test');
assert.equal(relayUrl.username, '');
assert.equal(relayUrl.password, '');
assert.equal(relayUrl.search, '');
assert.equal(relayUrl.hash, '');

if (prevUrl === undefined) delete process.env.AETHER_SUPABASE_URL; else process.env.AETHER_SUPABASE_URL = prevUrl;
if (prevKey === undefined) delete process.env.AETHER_SUPABASE_PUBLISHABLE_KEY; else process.env.AETHER_SUPABASE_PUBLISHABLE_KEY = prevKey;
if (prevRelay === undefined) delete process.env.AETHER_ACCOUNT_RELAY_URL; else process.env.AETHER_ACCOUNT_RELAY_URL = prevRelay;
delete require.cache[require.resolve('../lib/account/config.cjs')];

console.log('account config: environment-driven relay and supabase configuration is safe');
