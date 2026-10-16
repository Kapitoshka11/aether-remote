const crypto = require('node:crypto');
const { isPrivateOrLoopbackHostname } = require('../network-policy.cjs');

function sha256Base64(value) {
  return crypto.createHash('sha256').update(value).digest('base64');
}

function validateObsWebSocketUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch (_) { return false; }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return false;
  return isPrivateOrLoopbackHostname(parsed.hostname);
}

function createObsClient({ WebSocketImpl, url, password = '', requestTimeoutMs = 10000 }) {
  if (!validateObsWebSocketUrl(url)) throw new Error('OBS URL must use ws/wss with a numeric private or loopback host');
  let endpointUrl = url;
  let secretPassword = password;
  let socket = null;
  let connected = false;
  let requestCounter = 0;
  const pending = new Map();
  const listeners = new Set();

  function publish(patch) {
    for (const listener of listeners) listener(patch);
  }

  function eventPatch(eventType, data) {
    if (eventType === 'StreamStateChanged') return { 'obs.streaming': data.outputActive === true };
    if (eventType === 'RecordStateChanged') return { 'obs.recording': data.outputActive === true, 'obs.recordingPaused': data.outputPaused === true };
    if (eventType === 'CurrentProgramSceneChanged') return { 'obs.scene': data.sceneName || '' };
    if (eventType === 'StudioModeStateChanged') return { 'obs.studioMode': data.studioModeEnabled === true };
    if (eventType === 'InputMuteStateChanged') return { [`obs.input.${data.inputName}.muted`]: data.inputMuted === true };
    if (eventType === 'SceneItemEnableStateChanged') return { [`obs.sceneItem.${data.sceneName}.${data.sceneItemId}.enabled`]: data.sceneItemEnabled === true };
    return null;
  }

  function connect() {
    if (connected && socket) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const candidate = new WebSocketImpl(endpointUrl);
      socket = candidate;
      const timeout = setTimeout(() => reject(new Error('OBS connection timed out')), requestTimeoutMs);
      candidate.on('message', raw => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch (_) {
          publish({ 'obs.lastProtocolError': 'Malformed OBS WebSocket message ignored' });
          return;
        }
        if (message.op === 0) {
          const identify = { rpcVersion: Math.min(1, Number(message.d.rpcVersion) || 1), eventSubscriptions: 2047 };
          if (message.d.authentication) {
            const secret = sha256Base64(secretPassword + message.d.authentication.salt);
            identify.authentication = sha256Base64(secret + message.d.authentication.challenge);
          }
          candidate.send(JSON.stringify({ op: 1, d: identify }));
        } else if (message.op === 2) {
          clearTimeout(timeout);
          connected = true;
          publish({ 'obs.connected': true });
          resolve();
        } else if (message.op === 5) {
          const patch = eventPatch(message.d.eventType, message.d.eventData || {});
          if (patch) publish(patch);
        } else if (message.op === 7) {
          const entry = pending.get(message.d.requestId);
          if (!entry) return;
          pending.delete(message.d.requestId);
          clearTimeout(entry.timeout);
          if (message.d.requestStatus && message.d.requestStatus.result === true) entry.resolve(message.d.responseData || {});
          else entry.reject(new Error(message.d.requestStatus?.comment || `OBS request failed: ${message.d.requestStatus?.code || 'unknown'}`));
        }
      });
      candidate.on('error', error => {
        clearTimeout(timeout);
        if (!connected) reject(error);
      });
      candidate.on('close', () => {
        connected = false;
        publish({ 'obs.connected': false });
        for (const entry of pending.values()) {
          clearTimeout(entry.timeout);
          entry.reject(new Error('OBS disconnected'));
        }
        pending.clear();
      });
    });
  }

  function request(requestType, requestData = {}) {
    if (!connected || !socket) return Promise.reject(new Error('OBS is not connected'));
    const requestId = `aether-${Date.now()}-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`OBS request timed out: ${requestType}`));
      }, requestTimeoutMs);
      pending.set(requestId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  function disconnect() {
    if (socket) socket.close();
    socket = null;
    connected = false;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function configure(settings = {}) {
    disconnect();
    if (typeof settings.url === 'string' && settings.url) {
      if (!validateObsWebSocketUrl(settings.url)) throw new Error('OBS URL must use ws/wss with a numeric private or loopback host');
      endpointUrl = settings.url;
    }
    if (typeof settings.password === 'string') secretPassword = settings.password;
  }

  return { connect, disconnect, configure, request, subscribe, isConnected: () => connected };
}

module.exports = { createObsClient, sha256Base64, validateObsWebSocketUrl };
