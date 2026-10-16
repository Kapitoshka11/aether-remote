const { createPublicKey } = require('node:crypto');
const { createHash } = require('node:crypto');
const { normalizeMac } = require('./magic-packet.cjs');

function createWakeHostService({
  identityStore,
  groupStoreFactory,
  enrollmentFactory,
  relayApiFactory,
  bridgeFactory,
  relayClientFactory,
  relayUrl,
  host,
  onState = () => {}
}) {
  let identity = null;
  let groupStore = null;
  let enrollment = null;
  let relayApi = null;
  let relayClient = null;
  let localTargetDeviceId = null;
  let status = { status: 'stopped', bridgeEnabled: false, relayConnected: false, members: [], targets: [] };

  function publish(nextStatus, detail = '') {
    const loaded = groupStore?.load?.();
    const group = loaded?.ok ? loaded.group : null;
    status = {
      status: nextStatus,
      detail,
      groupId: group?.groupId || '',
      relayUrl: group?.relayUrl || relayUrl,
      bridgeEnabled: group?.bridgeEnabled === true,
      relayConnected: nextStatus === 'connected',
      members: Object.values(group?.members || {}).map(member => ({ deviceId: member.deviceId, role: member.role })),
      targets: Object.values(group?.targets || {}).map(target => ({ deviceId: target.deviceId, name: target.name }))
    };
    onState(status);
  }

  function getPublicKeySpki() {
    if (identity.publicKeySpki) return identity.publicKeySpki;
    return createPublicKey(identity.publicKeyPem).export({ type: 'spki', format: 'der' }).toString('base64');
  }

  async function start() {
    if (relayClient) return { ok: true, status: getStatus() };
    const identityResult = identityStore.loadOrCreate();
    if (!identityResult.ok) return identityResult;
    identity = identityResult.identity;
    groupStore = groupStoreFactory(identity);
    let groupResult = groupStore.createHomeGroup(relayUrl);
    if (!groupResult.ok) return groupResult;
    if (host.mac) {
      try {
        const normalizedMac = normalizeMac(host.mac);
        localTargetDeviceId = createHash('sha256').update(`AETHER_WAKE_TARGET:${normalizedMac}`).digest('hex').slice(0, 32);
        groupResult = groupStore.registerTarget({ deviceId: localTargetDeviceId, name: host.name, mac: normalizedMac });
        if (!groupResult.ok) return groupResult;
      } catch {
        return { ok: false, code: 'invalid_host_mac' };
      }
    }
    enrollment = enrollmentFactory({ groupStore, ownerIdentity: identity });
    relayApi = relayApiFactory(identity);
    const registered = await relayApi.registerGroup(groupResult.group);
    if (!registered.ok) {
      publish('error', registered.code);
      return registered;
    }
    const selfEnrollment = enrollment.approve({
      deviceId: identity.deviceId,
      publicKeySpki: getPublicKeySpki(),
      role: 'bridge'
    });
    if (!selfEnrollment.ok) return selfEnrollment;
    const enrolled = await relayApi.enrollMember(groupResult.group, selfEnrollment.certificate);
    if (!enrolled.ok) {
      publish('error', enrolled.code);
      return enrolled;
    }
    publish('starting');
    const current = groupStore.load();
    if (!current.ok) return current;
    if (current.group.bridgeEnabled) {
      relayClient = relayClientFactory({
        relayUrl: current.group.relayUrl,
        groupId: current.group.groupId,
        deviceId: identity.deviceId,
        presenceDeviceId: localTargetDeviceId || identity.deviceId,
        certificate: selfEnrollment.certificate,
        bridge: bridgeFactory({ identity, group: current.group, groupStore }),
        onState: relayState => publish(relayState.status, relayState.detail)
      });
      relayClient.start();
    }
    return { ok: true, status: getStatus() };
  }

  async function approvePhone(request) {
    if (!enrollment || !relayApi || !groupStore) return { ok: false, code: 'not_started' };
    const result = enrollment.approve({ ...request, role: 'phone' });
    if (!result.ok) return result;
    const groupResult = groupStore.load();
    if (!groupResult.ok) return groupResult;
    const enrolled = await relayApi.enrollMember(groupResult.group, result.certificate);
    if (!enrolled.ok) return enrolled;
    publish(status.status, status.detail);
    return {
      ...result,
      targets: Object.values(groupResult.group.targets || {}).map(target => ({
        deviceId: target.deviceId,
        name: target.name,
        mac: target.mac
      }))
    };
  }

  async function setBridgeEnabled(enabled) {
    if (!groupStore) return { ok: false, code: 'not_started' };
    const saved = groupStore.setBridgeEnabled(enabled);
    if (!saved.ok) return saved;
    if (!enabled && relayClient) {
      relayClient.stop();
      relayClient = null;
      publish('disabled');
    } else if (enabled && !relayClient) {
      return start();
    }
    return { ok: true, status: getStatus() };
  }

  async function revokeMember(deviceId) {
    if (!groupStore || !relayApi || deviceId === identity?.deviceId) return { ok: false, code: 'invalid_member' };
    const loaded = groupStore.load();
    if (!loaded.ok) return loaded;
    const revoked = await relayApi.revokeMember(loaded.group, deviceId);
    if (!revoked.ok) return revoked;
    const removed = groupStore.removeMember(deviceId);
    if (!removed.ok) return removed;
    publish(status.status, status.detail);
    return { ok: true };
  }

  function registerTarget({ name, mac }) {
    if (!groupStore) return { ok: false, code: 'not_started' };
    try {
      const normalizedMac = normalizeMac(mac);
      const deviceId = createHash('sha256').update(`AETHER_WAKE_TARGET:${normalizedMac}`).digest('hex').slice(0, 32);
      const saved = groupStore.registerTarget({ deviceId, name, mac: normalizedMac });
      if (!saved.ok) return saved;
      publish(status.status, status.detail);
      return { ok: true, target: { deviceId, name: saved.group.targets[deviceId].name } };
    } catch {
      return { ok: false, code: 'invalid_target' };
    }
  }

  function stop() {
    relayClient?.stop();
    relayClient = null;
    publish('stopped');
  }

  function getStatus() {
    return JSON.parse(JSON.stringify(status));
  }

  return { start, stop, getStatus, approvePhone, setBridgeEnabled, revokeMember, registerTarget };
}

module.exports = { createWakeHostService };
