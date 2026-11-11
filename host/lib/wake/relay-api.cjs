const { createPublicKey, randomBytes } = require('node:crypto');
const { createGroupRegistration, createMemberRevocation } = require('./protocol.cjs');

function createWakeRelayApi({
  fetchImpl = fetch,
  identity,
  clock = Date.now,
  randomBytesImpl = randomBytes,
  timeoutMs = 10_000
}) {
  async function post(url, body) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch {}
      return response.ok
        ? { ok: true, status: response.status }
        : { ok: false, status: response.status, code: typeof payload.error === 'string' ? payload.error : 'relay_error' };
    } catch (error) {
      return { ok: false, status: 0, code: error?.name === 'TimeoutError' ? 'relay_timeout' : 'relay_unavailable' };
    }
  }

  function endpoint(group, suffix) {
    return new URL(`/v1/groups${suffix}`, group.relayUrl).toString();
  }

  async function registerGroup(group) {
    const now = clock();
    const publicKeySpki = group.ownerPublicKeySpki || createPublicKey(identity.publicKeyPem)
      .export({ type: 'spki', format: 'der' }).toString('base64');
    const registration = createGroupRegistration({
      groupId: group.groupId,
      ownerDeviceId: identity.deviceId,
      ownerPublicKeySpki: publicKeySpki,
      nonce: randomBytesImpl(16).toString('hex'),
      issuedAt: now,
      expiresAt: now + 30_000
    }, identity.privateKeyPem);
    return post(endpoint(group, ''), registration);
  }

  function enrollMember(group, certificate) {
    return post(endpoint(group, `/${group.groupId}/members`), certificate);
  }

  function revokeMember(group, deviceId) {
    const now = clock();
    const revocation = createMemberRevocation({
      groupId: group.groupId,
      ownerDeviceId: identity.deviceId,
      deviceId,
      nonce: randomBytesImpl(16).toString('hex'),
      issuedAt: now,
      expiresAt: now + 30_000
    }, identity.privateKeyPem);
    return post(endpoint(group, `/${group.groupId}/revoke`), revocation);
  }

  return { registerGroup, enrollMember, revokeMember };
}

module.exports = { createWakeRelayApi };
