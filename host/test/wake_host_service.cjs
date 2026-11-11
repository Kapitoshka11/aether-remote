const assert = require('node:assert/strict');
const { createWakeHostService } = require('../lib/wake/host-service.cjs');

async function run() {
  const identity = { deviceId: '11'.repeat(16), publicKeyPem: 'public', privateKeyPem: 'private', publicKeySpki: 'host-spki' };
  const group = {
    groupId: '22'.repeat(16), ownerDeviceId: identity.deviceId, relayUrl: 'https://relay.example',
    ownerPublicKeySpki: 'owner-spki', bridgeEnabled: true, members: {}, targets: {}
  };
  const events = [];
  let activeRelay = null;
  const groupStore = {
    createHomeGroup: () => ({ ok: true, group }),
    load: () => ({ ok: true, group }),
    registerTarget: target => { group.targets[target.deviceId] = target; events.push(['target', target]); return { ok: true, group }; },
    setBridgeEnabled: enabled => { group.bridgeEnabled = enabled; events.push(['enabled', enabled]); return { ok: true, group }; },
    getMemberPublicKey: () => 'phone-public',
    removeMember: deviceId => { delete group.members[deviceId]; return { ok: true, group }; }
  };
  const enrollment = {
    approve: request => {
      const certificate = { groupId: group.groupId, deviceId: request.deviceId, role: request.role, publicKeySpki: request.publicKeySpki };
      group.members[request.deviceId] = certificate;
      return { ok: true, groupId: group.groupId, relayUrl: group.relayUrl, ownerPublicKeySpki: group.ownerPublicKeySpki, certificate };
    }
  };
  const api = {
    registerGroup: async () => { events.push(['register']); return { ok: true, status: 201 }; },
    enrollMember: async (_group, cert) => { events.push(['enroll', cert.role]); return { ok: true, status: 201 }; },
    revokeMember: async (_group, id) => { events.push(['revoke', id]); return { ok: true, status: 200 }; }
  };
  const service = createWakeHostService({
    identityStore: { loadOrCreate: () => ({ ok: true, identity }) },
    groupStoreFactory: () => groupStore,
    enrollmentFactory: () => enrollment,
    relayApiFactory: () => api,
    bridgeFactory: () => ({ deliver: async () => ({ status: 'delivered' }) }),
    relayClientFactory: options => {
      activeRelay = { options, started: false, stopped: false, start() { this.started = true; }, stop() { this.stopped = true; } };
      return activeRelay;
    },
    relayUrl: 'https://relay.example',
    host: { name: 'Gaming PC', mac: 'AA:BB:CC:DD:EE:FF' },
    onState: state => events.push(['state', state.status])
  });

  assert.equal((await service.start()).ok, true);
  assert.equal(activeRelay.started, true);
  assert.match(activeRelay.options.presenceDeviceId, /^[0-9a-f]{32}$/);
  assert.notEqual(activeRelay.options.presenceDeviceId, identity.deviceId);
  assert.deepEqual(events.slice(0, 4).map(value => value[0]), ['target', 'register', 'enroll', 'state']);
  assert.equal(service.getStatus().bridgeEnabled, true);
  assert.equal(service.getStatus().privateKeyPem, undefined);
  const addedTarget = service.registerTarget({ name: 'Bedroom PC', mac: '00:11:22:33:44:55' });
  assert.equal(addedTarget.ok, true);
  assert.match(addedTarget.target.deviceId, /^[0-9a-f]{32}$/);
  assert.equal(addedTarget.target.mac, undefined);

  const phoneId = '33'.repeat(16);
  const approved = await service.approvePhone({ deviceId: phoneId, publicKeySpki: 'phone-spki' });
  assert.equal(approved.ok, true);
  assert.equal(approved.certificate.role, 'phone');
  assert.equal(approved.targets.some(target => target.name === 'Bedroom PC' && target.mac.replaceAll(':', '') === '001122334455'), true);
  assert.equal(events.some(value => value[0] === 'enroll' && value[1] === 'phone'), true);

  assert.equal((await service.setBridgeEnabled(false)).ok, true);
  assert.equal(activeRelay.stopped, true);
  assert.equal((await service.revokeMember(phoneId)).ok, true);
  assert.equal(events.some(value => value[0] === 'revoke' && value[1] === phoneId), true);

  console.log('Wake host service tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
