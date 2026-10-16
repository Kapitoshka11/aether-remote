const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { AccountRelayHost } = require('../lib/account/relay-host.cjs');
const { createIdentity } = require('../lib/account/protocol.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  const identity = createIdentity(), phone = createIdentity(), ownerId = crypto.randomUUID();
  let rows = [], connects = 0, accepts = 0, removed = 0, release;
  const channel = new EventEmitter();
  channel.on = function (_event, filter, callback) { assert.equal(filter.filter, `owner_id=eq.${ownerId}`); this.notify = callback; return this; };
  channel.subscribe = function (callback) { this.status = callback; return this; };
  const client = { channel: () => channel, removeChannel: async () => { removed++; },
    auth: { getSession: async () => ({ data: { session: { user: { id: ownerId }, access_token: 'test-token' } } }) } };
  const row = () => ({ id: crypto.randomUUID(), owner_id: ownerId, host_id: identity.id,
    phone_id: phone.id, state: 'pending', expires_at: new Date(Date.now() + 90000).toISOString() });
  const relay = new AccountRelayHost({ client, directory: { sessions: async () => rows }, ownerId, identity,
    url: 'wss://relay.example.test', acceptStream: () => { accepts++; },
    connect: async options => { connects++; assert.equal(options.accessToken, 'test-token');
      if (release) await new Promise(resolve => { release = resolve; });
      return new PassThrough(); } });
  try {
    await tick();
    const good = row();
    rows = [good, { ...row(), owner_id: crypto.randomUUID() }, { ...row(), host_id: phone.id },
      { ...row(), expires_at: 'invalid' }, { ...row(), state: 'closed' }];
    channel.status('SUBSCRIBED');
    await tick();
    assert.equal(connects, 1);
    assert.equal(accepts, 1);
    assert.equal(relay.matches(good.id, phone.id), true);
    assert.equal(relay.matches(good.id, identity.id), false);
    channel.notify(); await tick();
    assert.equal(connects, 1, 'duplicate notification must not create a second join');
    relay.revoke(phone.id);
    assert.equal(relay.matches(good.id), false);
    await relay.reconcile();
    assert.equal(connects, 1, 'revoked or consumed session must not reopen');
    rows = [row()]; release = true;
    await relay.reconcile(); await tick();
    relay.dispose(); release(); await tick();
    assert.equal(accepts, 1, 'logout during join must discard the arriving stream');
    assert.equal(relay.entries.size, 0);
    assert.equal(removed, 1);
    console.log('account relay host: owner/host filtering, reconciliation, deduplication, revocation and logout race passed');
  } finally { if (!relay.stopped) relay.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
