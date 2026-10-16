const { validateWakeRequest, verifyWakeRequest } = require('./protocol.cjs');

function createWakeBridge({
  enabled,
  groupId,
  memberStore,
  targetStore,
  udpSender,
  nonceStore,
  clock = Date.now
}) {
  async function deliver(request) {
    if (!enabled()) return { status: 'rejected', code: 'bridge_disabled' };
    const now = clock();
    const validation = validateWakeRequest(request, now);
    if (!validation.ok) {
      return { status: 'rejected', code: validation.code === 'expired' ? 'expired' : 'invalid_request' };
    }
    if (request.groupId !== groupId) return { status: 'rejected', code: 'invalid_group' };
    const publicKey = memberStore.getPublicKey(request.senderDeviceId);
    if (!publicKey) return { status: 'rejected', code: 'unknown_sender' };
    if (!verifyWakeRequest(request, publicKey, now)) return { status: 'rejected', code: 'invalid_signature' };
    if (nonceStore.has(request.nonce)) return { status: 'rejected', code: 'replay' };
    const target = targetStore.get(request.targetDeviceId);
    if (!target) return { status: 'rejected', code: 'unknown_target' };
    nonceStore.add(request.nonce, request.expiresAt);
    await udpSender(target.mac);
    return { status: 'delivered', code: 'sent', deliveredAt: now };
  }

  return { deliver };
}

module.exports = { createWakeBridge };
