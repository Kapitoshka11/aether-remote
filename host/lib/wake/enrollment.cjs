const { createPublicKey } = require('node:crypto');
const { createMembershipCertificate } = require('./protocol.cjs');

function createWakeEnrollment({ groupStore, ownerIdentity, clock = Date.now }) {
  function parsePublicKey(publicKeySpki) {
    try {
      if (typeof publicKeySpki !== 'string' || publicKeySpki.length > 2048) return null;
      const der = Buffer.from(publicKeySpki, 'base64');
      const key = createPublicKey({ key: der, type: 'spki', format: 'der' });
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
      const canonical = key.export({ type: 'spki', format: 'der' }).toString('base64');
      return canonical === publicKeySpki ? canonical : null;
    } catch {
      return null;
    }
  }

  function approve({ deviceId, publicKeySpki, role }) {
    const groupResult = groupStore.load();
    if (!groupResult.ok) return groupResult;
    if (!/^[0-9a-f]{32}$/.test(deviceId) || !['phone', 'bridge', 'host'].includes(role)) {
      return { ok: false, code: 'invalid_enrollment' };
    }
    const canonicalPublicKey = parsePublicKey(publicKeySpki);
    if (!canonicalPublicKey) return { ok: false, code: 'invalid_public_key' };
    const existing = groupStore.getMember(deviceId);
    if (existing) {
      if (existing.publicKeySpki !== canonicalPublicKey || existing.role !== role) return { ok: false, code: 'member_conflict' };
      return {
        ok: true,
        groupId: groupResult.group.groupId,
        relayUrl: groupResult.group.relayUrl,
        ownerPublicKeySpki: groupResult.group.ownerPublicKeySpki,
        certificate: existing
      };
    }
    const now = clock();
    const certificate = createMembershipCertificate({
      groupId: groupResult.group.groupId,
      deviceId,
      role,
      publicKeySpki: canonicalPublicKey,
      issuedAt: now,
      expiresAt: now + 31_536_000_000
    }, ownerIdentity.privateKeyPem);
    const stored = groupStore.addMember(certificate);
    if (!stored.ok) return stored;
    return {
      ok: true,
      groupId: groupResult.group.groupId,
      relayUrl: groupResult.group.relayUrl,
      ownerPublicKeySpki: groupResult.group.ownerPublicKeySpki,
      certificate
    };
  }

  return { approve };
}

module.exports = { createWakeEnrollment };
