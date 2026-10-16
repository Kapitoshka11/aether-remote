const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { AccountHostService } = require('../lib/account/host-service.cjs');
const { createSecureStore } = require('../lib/account/secure-store.cjs');
const { createIdentity, signProof, verifyGrant } = require('../lib/account/protocol.cjs');

class Socket extends EventEmitter {
  readyState = 1; messages = []; isAuth = false;
  send(text) { this.messages.push(JSON.parse(text)); }
  close() { if (this.readyState === 1) { this.readyState = 3; this.emit('close'); } }
}

(async () => {
  const ownerId = crypto.randomUUID();
  const host = createIdentity(), phone = createIdentity();
  let approval = true, approvals = 0, lookups = 0, offline = false, registeredHost;
  const devices = [
    { ...host, ownerId, name: 'Test PC', kind: 'host', tlsFingerprint: 'a'.repeat(64) },
    { ...phone, ownerId, name: 'Test phone', kind: 'phone' }
  ];
  const grants = [];
  const directory = {
    async devices() { if (offline) throw new Error('offline'); return structuredClone(devices); },
    async grants() { if (offline) throw new Error('offline'); return structuredClone(grants); },
    async register(_identity, hostInfo) { if (devices[0].revokedAt) throw new Error('device_revoked'); registeredHost = hostInfo; },
    async publishGrant(grant) { grants.push({ grant }); },
    async revokeDevice(id) { devices.find(d => d.id === id).revokedAt = '2026-09-07T00:00:00Z'; }
  };
  const auth = new EventEmitter();
  auth.profile = { id: ownerId, email: 'test@example.test', confirmed: true };
  auth.snapshot = () => ({ profile: auth.profile });
  auth.dispose = () => {};
  auth.client = { auth: { async getUser(token) {
    lookups++;
    return { data: { user: { id: token === 'valid-test-token' ? ownerId : crypto.randomUUID(), email_confirmed_at: '2026-09-07' } } };
  } } };
  const service = new AccountHostService({ storage: await createSecureStore({}), identity: host,
    getHost: () => ({ name: 'Test PC', tlsFingerprint: 'a'.repeat(64), lanIp: '192.168.1.2',
      networkEndpoints: ['192.168.1.2', '100.84.2.10'], port: 8080 }),
    initialProfile: auth.profile, authFactory: () => auth, directoryFactory: () => directory,
    requestApproval: async (_ip, description) => { approvals++; assert.match(description, /код \d{6}$/); return approval; } });
  const hello = (grantId, token = 'valid-test-token') => ({ action: 'ACCOUNT_HELLO', ownerId, hostId: host.id,
    phoneId: phone.id, sessionId: crypto.randomUUID(), grantId, accessToken: token });
  const authorize = (socket, grant) => { socket.isAuth = true; socket.grant = grant; };
  try {
    await service.refresh();
    assert.equal(service.online, true);
    assert.deepEqual(registeredHost.networkEndpoints, ['192.168.1.2', '100.84.2.10']);
    const wrongOwner = new Socket();
    await service.handle(wrongOwner, hello(undefined, 'different-owner'), () => assert.fail('cross-account accepted'));
    assert.equal(wrongOwner.readyState, 3);
    const first = new Socket();
    await service.handle(first, hello(), grant => authorize(first, grant));
    assert.equal(first.messages[0].status, 'ACCOUNT_CHALLENGE');
    assert.equal(first.isAuth, false);
    await service.handle(first, { ...signProof(first.messages[0], phone.privateKeyPem), action: 'ACCOUNT_PROOF' }, grant => authorize(first, grant));
    assert.equal(first.isAuth, true);
    assert.equal(service.snapshot().devices.find(d => d.id === phone.id).trustedHere, true);
    assert.equal(approvals, 1);
    assert.equal(verifyGrant(first.grant, host.publicKeySpki), true);
    assert.equal(grants.length, 1);
    first.close();
    const approvedGrant = first.grant;
    offline = true;
    await service.refresh();
    assert.equal(service.online, false);
    const callsBefore = lookups;
    const reconnect = new Socket();
    await service.handle(reconnect, hello(approvedGrant.grantId, undefined), grant => authorize(reconnect, grant));
    await service.handle(reconnect, { ...signProof(reconnect.messages[0], phone.privateKeyPem), action: 'ACCOUNT_PROOF' }, grant => authorize(reconnect, grant));
    assert.equal(reconnect.isAuth, true);
    assert.equal(lookups, callsBefore, 'offline trusted connection requires no cloud token');
    assert.equal(approvals, 1);
    const replay = new Socket();
    await service.handle(replay, hello(approvedGrant.grantId), () => assert.fail('replay accepted'));
    await service.handle(replay, { ...signProof(reconnect.messages[0], phone.privateKeyPem), action: 'ACCOUNT_PROOF' }, () => assert.fail('replay accepted'));
    assert.equal(replay.readyState, 3);
    offline = false;
    devices[0].revokedAt = '2026-09-07T00:00:00Z';
    await service.refresh();
    assert.equal(reconnect.readyState, 3, 'revoked host closes established sockets before heartbeat rejection');
    assert.equal(service.trust.isAllowed(approvedGrant), false);
    assert.equal(service.snapshot().devices.find(d => d.id === phone.id).trustedHere, false);
    devices[0].revokedAt = null;
    await service.refresh();
    assert.equal(service.trust.isAllowed(approvedGrant), false, 'stale cloud state cannot undo local revocation');
    console.log('account host service: enrollment, owner isolation, offline reconnect, replay and revocation passed');
  } finally { service.dispose(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
