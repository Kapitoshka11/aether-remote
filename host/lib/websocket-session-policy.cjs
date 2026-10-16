'use strict';

const MAX_CONTROL_CONNECTIONS = 64;
const MAX_PREAUTH_CONNECTIONS = 16;
const PREAUTH_TIMEOUT_MS = 70_000;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

function isGuestSessionActive(ws, tokens, now = Date.now()) {
  if (ws?.accountAuthentication === true) return ws.isAuth === true;
  if (ws?.isAuth !== true || !ws.sessionToken) return false;
  const info = tokens.get(ws.sessionToken);
  return !!info && Number.isFinite(info.expiresAt) && info.expiresAt > now;
}

function scheduleAbsoluteExpiry(expiresAt, onExpire, timers = globalThis) {
  let timer = null;
  let cancelled = false;
  const arm = () => {
    if (cancelled) return;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      onExpire();
      return;
    }
    timer = timers.setTimeout(arm, Math.min(remaining, MAX_TIMER_DELAY_MS));
    timer?.unref?.();
  };
  arm();
  return () => {
    cancelled = true;
    if (timer) timers.clearTimeout(timer);
  };
}

function connectionAdmission(clients) {
  const sockets = Array.from(clients || []);
  const preauth = sockets.filter(client => client.isAuth !== true).length;
  return {
    totalAllowed: sockets.length <= MAX_CONTROL_CONNECTIONS,
    preauthAllowed: preauth <= MAX_PREAUTH_CONNECTIONS
  };
}

module.exports = {
  MAX_CONTROL_CONNECTIONS,
  MAX_PREAUTH_CONNECTIONS,
  PREAUTH_TIMEOUT_MS,
  isGuestSessionActive,
  scheduleAbsoluteExpiry,
  connectionAdmission
};
