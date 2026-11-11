const fs = require('node:fs');
const path = require('node:path');
const { createPublicKey, randomBytes } = require('node:crypto');
const { normalizeMac } = require('./magic-packet.cjs');

function createWakeGroupStore({ filePath, safeStorage, ownerIdentity, fsImpl = fs }) {
  function validateRelayUrl(value) {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname))) {
      throw new Error('invalid_relay_url');
    }
    return parsed.origin;
  }

  function isGroup(group) {
    return group
      && group.version === 1
      && /^[0-9a-f]{32}$/.test(group.groupId)
      && /^[0-9a-f]{32}$/.test(group.ownerDeviceId)
      && typeof group.ownerPublicKeySpki === 'string'
      && typeof group.relayUrl === 'string'
      && typeof group.bridgeEnabled === 'boolean'
      && group.members && typeof group.members === 'object'
      && group.targets && typeof group.targets === 'object';
  }

  function load() {
    if (!safeStorage?.isEncryptionAvailable?.()) return { ok: false, code: 'encryption_unavailable' };
    if (!fsImpl.existsSync(filePath)) return { ok: false, code: 'group_missing' };
    try {
      const group = JSON.parse(safeStorage.decryptString(fsImpl.readFileSync(filePath)));
      return isGroup(group) ? { ok: true, group } : { ok: false, code: 'group_corrupt' };
    } catch {
      return { ok: false, code: 'group_corrupt' };
    }
  }

  function save(group) {
    const encrypted = safeStorage.encryptString(JSON.stringify(group));
    fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fsImpl.writeFileSync(temporaryPath, encrypted, { flag: 'wx' });
      fsImpl.renameSync(temporaryPath, filePath);
    } finally {
      if (fsImpl.existsSync(temporaryPath)) fsImpl.unlinkSync(temporaryPath);
    }
    return { ok: true, group };
  }

  function createHomeGroup(relayUrl) {
    if (fsImpl.existsSync(filePath)) return load();
    const ownerPublicKeySpki = createPublicKey(ownerIdentity.publicKeyPem)
      .export({ type: 'spki', format: 'der' })
      .toString('base64');
    return save({
      version: 1,
      groupId: randomBytes(16).toString('hex'),
      ownerDeviceId: ownerIdentity.deviceId,
      ownerPublicKeySpki,
      relayUrl: validateRelayUrl(relayUrl),
      bridgeEnabled: true,
      members: {},
      targets: {}
    });
  }

  function registerTarget(target) {
    const result = load();
    if (!result.ok) return result;
    if (!/^[0-9a-f]{32}$/.test(target.deviceId) || typeof target.name !== 'string' || target.name.trim().length === 0) {
      return { ok: false, code: 'invalid_target' };
    }
    const normalized = normalizeMac(target.mac);
    const mac = normalized.match(/.{2}/g).join(':');
    const group = {
      ...result.group,
      targets: { ...result.group.targets, [target.deviceId]: { deviceId: target.deviceId, name: target.name.trim().slice(0, 128), mac } }
    };
    return save(group);
  }

  function getTarget(deviceId) {
    const result = load();
    return result.ok ? result.group.targets[deviceId] || null : null;
  }

  function setBridgeEnabled(enabled) {
    const result = load();
    if (!result.ok) return result;
    return save({ ...result.group, bridgeEnabled: enabled === true });
  }

  function addMember(certificate) {
    const result = load();
    if (!result.ok) return result;
    if (certificate.groupId !== result.group.groupId || !/^[0-9a-f]{32}$/.test(certificate.deviceId)) {
      return { ok: false, code: 'invalid_member' };
    }
    const existing = result.group.members[certificate.deviceId];
    if (existing) {
      const same = existing.publicKeySpki === certificate.publicKeySpki && existing.role === certificate.role;
      return same ? { ok: true, group: result.group, certificate: existing } : { ok: false, code: 'member_conflict' };
    }
    const group = {
      ...result.group,
      members: { ...result.group.members, [certificate.deviceId]: certificate }
    };
    const saved = save(group);
    return { ...saved, certificate };
  }

  function getMember(deviceId) {
    const result = load();
    return result.ok ? result.group.members[deviceId] || null : null;
  }

  function getMemberPublicKey(deviceId) {
    const member = getMember(deviceId);
    if (!member) return null;
    try {
      return createPublicKey({ key: Buffer.from(member.publicKeySpki, 'base64'), type: 'spki', format: 'der' })
        .export({ type: 'spki', format: 'pem' });
    } catch {
      return null;
    }
  }

  function removeMember(deviceId) {
    const result = load();
    if (!result.ok) return result;
    if (!result.group.members[deviceId]) return { ok: false, code: 'member_missing' };
    const members = { ...result.group.members };
    delete members[deviceId];
    return save({ ...result.group, members });
  }

  return {
    load,
    createHomeGroup,
    registerTarget,
    getTarget,
    setBridgeEnabled,
    addMember,
    getMember,
    getMemberPublicKey,
    removeMember
  };
}

module.exports = { createWakeGroupStore };
