function normalizeTokenInfo(info, now, ttlMs) {
  const value = info && typeof info === 'object' ? info : {};
  return {
    ...value,
    issuedAt: Number.isFinite(value.issuedAt) ? value.issuedAt : now,
    expiresAt: Number.isFinite(value.expiresAt) ? value.expiresAt : now + ttlMs,
    trusted: value.trusted === true,
    deviceName: String(value.deviceName || 'Aether mobile client').slice(0, 80),
    ipAddress: String(value.ipAddress || '').slice(0, 80)
  };
}

function decideApproval({ credentialValid, tokenTrusted }) {
  if (!credentialValid) return 'reject';
  return tokenTrusted === true ? 'approve-now' : 'prompt';
}

function handleAuthAttempt({ identifier, enteredPin, passedToken, failures, authenticate, now = Date.now() }) {
  let tokenFailure = null;
  if (passedToken) {
    const tokenResult = authenticate('', passedToken);
    if (tokenResult.success) {
      failures.delete(identifier);
      return { success: true, token: tokenResult.token, isNewToken: false, trusted: tokenResult.trusted === true };
    }
    tokenFailure = tokenResult;
  }

  const hasPin = String(enteredPin || '').trim().length > 0;
  if (!hasPin) {
    return {
      success: false,
      isBlocked: false,
      reason: tokenFailure?.reason || 'Empty PIN provided',
      remainingAttempts: Math.max(0, 3 - (failures.get(identifier)?.count || 0)),
      cooldown: 0
    };
  }

  const attempts = failures.get(identifier) || { count: 0, blockedUntil: 0, lastActivity: now };
  if (attempts.count >= 3 && now < attempts.blockedUntil) {
    const remainingSec = Math.ceil((attempts.blockedUntil - now) / 1000);
    return { success: false, isBlocked: true, reason: `Too many pairing attempts from this network address (possibly shared). Try again in ${remainingSec} seconds.`, remainingAttempts: 0, cooldown: remainingSec };
  }

  const authResult = authenticate(enteredPin, '');
  if (authResult.success) {
    failures.delete(identifier);
    return { success: true, token: authResult.token, isNewToken: authResult.isNewToken === true, trusted: authResult.trusted === true };
  }

  const newCount = attempts.count + 1;
  const isBlocked = newCount >= 3;
  const exponent = Math.min(Math.max(0, newCount - 3), 5);
  const blockedUntil = isBlocked ? now + (60 * 1000 * (2 ** exponent)) : 0;
  failures.set(identifier, { count: newCount, blockedUntil, lastActivity: now });
  return {
    success: false,
    isBlocked,
    reason: authResult.reason || 'Incorrect PIN or pairing key',
    remainingAttempts: Math.max(0, 3 - newCount),
    cooldown: isBlocked ? Math.ceil((blockedUntil - now) / 1000) : 0
  };
}

module.exports = { normalizeTokenInfo, decideApproval, handleAuthAttempt };
