const crypto = require('node:crypto');
const { signGrant, verifyGrant } = require('./protocol.cjs');

async function createTrustStore(storage, identity, ownerId) {
  if (!/^[0-9a-f-]{36}$/.test(ownerId)) throw new Error('invalid_account_owner');
  const key = `trust-v1-${ownerId}`;
  const raw = await storage.getItem(key);
  let state = raw ? JSON.parse(raw) : { grants: [], revokedDevices: [], revokedGrants: [] };
  state.pendingRevocations ??= [];
  if (!Array.isArray(state.grants) || !Array.isArray(state.revokedDevices) || !Array.isArray(state.revokedGrants) ||
      !Array.isArray(state.pendingRevocations) || [...state.revokedDevices, ...state.pendingRevocations].some(id => !/^[0-9a-f]{64}$/.test(id)) ||
      state.grants.some(g => g.ownerId !== ownerId || !verifyGrant(g, identity.publicKeySpki))) throw new Error('account_trust_corrupt');
  let queue = Promise.resolve();
  const mutate = fn => {
    const operation = queue.then(async () => {
      const next = structuredClone(state);
      const result = fn(next);
      await storage.setItem(key, JSON.stringify(next));
      state = next;
      return structuredClone(result);
    });
    queue = operation.catch(() => {});
    return operation;
  };
  function isAllowed(grant) {
    return verifyGrant(grant, identity.publicKeySpki) && grant.ownerId === ownerId && grant.hostId === identity.id &&
      !state.revokedDevices.includes(identity.id) && !state.revokedDevices.includes(grant.phoneId) &&
      !state.revokedGrants.includes(grant.grantId) &&
      state.grants.some(g => g.grantId === grant.grantId && g.signature === grant.signature && g.revision === grant.revision);
  }
  return {
    isAllowed,
    find(phoneId, grantId) { return structuredClone(state.grants.find(g => g.phoneId === phoneId && g.grantId === grantId && isAllowed(g)) ?? null); },
    list() { return structuredClone(state.grants); },
    revokedDevices() { return [...state.revokedDevices]; },
    pendingRevocations() { return [...state.pendingRevocations]; },
    acknowledgeRevocation(id) { return mutate(next => { next.pendingRevocations = next.pendingRevocations.filter(value => value !== id); }); },
    // Call only from the successful, explicit local PC approval path.
    approve(phone, fingerprint, minimumRevision = 1) {
      return mutate(next => {
        if (phone.ownerId !== ownerId || phone.kind !== 'phone' || phone.revokedAt ||
            next.revokedDevices.includes(phone.id) || next.revokedDevices.includes(identity.id)) throw new Error('account_device_revoked');
        const previous = next.grants.filter(g => g.phoneId === phone.id);
        if (!Number.isInteger(minimumRevision) || minimumRevision < 1) throw new Error('invalid_grant_revision');
        const revision = Math.max(minimumRevision, Math.max(0, ...previous.map(g => g.revision)) + 1);
        const grant = signGrant({ ownerId, hostId: identity.id, phoneId: phone.id,
          phonePublicKeySpki: phone.publicKeySpki, hostTlsFingerprint: fingerprint,
          grantId: crypto.randomUUID(), revision, issuedAt: Date.now() }, identity.privateKeyPem);
        next.revokedGrants = [...new Set([...next.revokedGrants, ...previous.map(g => g.grantId)])];
        next.grants.push(grant);
        return grant;
      });
    },
    revokeDevice(id) {
      if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('invalid_device_id');
      return mutate(next => {
        if (!next.revokedDevices.includes(id)) next.revokedDevices.push(id);
        if (!next.pendingRevocations.includes(id)) next.pendingRevocations.push(id);
      });
    },
    mergeRevocations(devices, grants) {
      return mutate(next => {
        for (const device of devices) if (device.ownerId === ownerId && device.revokedAt && !next.revokedDevices.includes(device.id)) next.revokedDevices.push(device.id);
        for (const item of grants) if (item.grant.ownerId === ownerId && item.revokedAt && !next.revokedGrants.includes(item.grant.grantId)) next.revokedGrants.push(item.grant.grantId);
      });
    },
    async clear() {
      // Logout removes permissions but must not undo a denial awaiting cloud synchronization.
      await mutate(next => { next.grants = []; next.revokedGrants = []; });
    }
  };
}

module.exports = { createTrustStore };
