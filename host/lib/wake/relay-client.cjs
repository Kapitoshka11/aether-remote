const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000];

function relaySocketUrl(relayUrl, groupId, deviceId, certificate) {
  const url = new URL(`/v1/groups/${groupId}/socket`, relayUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', deviceId);
  url.searchParams.set('certificate', Buffer.from(JSON.stringify(certificate)).toString('base64url'));
  return url.toString();
}

function createWakeRelayClient({
  WebSocketImpl,
  relayUrl,
  groupId,
  deviceId,
  certificate,
  presenceDeviceId = deviceId,
  bridge,
  onState = () => {},
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  random = Math.random,
  clock = Date.now
}) {
  let socket = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let running = false;

  function publish(status, detail = '') {
    onState({ status, detail, reconnectAttempt });
  }

  function scheduleReconnect() {
    if (!running || reconnectTimer !== null) return;
    const base = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    const delay = base + Math.floor(Math.max(0, Math.min(1, random())) * 250);
    reconnectAttempt += 1;
    publish('reconnecting', `retry_in_${delay}`);
    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  async function handleMessage(raw) {
    if (!running || !socket) return;
    let message;
    try {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (Buffer.byteLength(text) > 16_384) return;
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message?.type !== 'wake.request') return;
    let result;
    try {
      result = await bridge.deliver(message);
    } catch {
      result = { status: 'rejected', code: 'bridge_error' };
    }
    if (!running || !socket || socket.readyState !== WebSocketImpl.OPEN) return;
    socket.send(JSON.stringify({
      type: 'wake.delivery',
      nonce: message.nonce,
      targetDeviceId: message.targetDeviceId,
      ...result
    }));
  }

  function connect() {
    if (!running) return;
    publish('connecting');
    let candidate;
    try {
      candidate = new WebSocketImpl(relaySocketUrl(relayUrl, groupId, deviceId, certificate));
    } catch (error) {
      publish('error', error instanceof Error ? error.message : 'socket_create_failed');
      scheduleReconnect();
      return;
    }
    socket = candidate;
    candidate.on('open', () => {
      if (!running || socket !== candidate) return;
      reconnectAttempt = 0;
      publish('connected');
      candidate.send(JSON.stringify({
        version: 1,
        type: 'host.online',
        deviceId: presenceDeviceId,
        onlineAt: clock()
      }));
    });
    candidate.on('message', raw => {
      if (socket === candidate) void handleMessage(raw);
    });
    candidate.on('error', () => {
      if (running && socket === candidate) publish('error', 'socket_error');
    });
    candidate.on('close', () => {
      if (socket === candidate) socket = null;
      scheduleReconnect();
    });
  }

  function start() {
    if (running) return;
    running = true;
    reconnectAttempt = 0;
    connect();
  }

  function stop() {
    running = false;
    if (reconnectTimer !== null) {
      clearTimeoutImpl(reconnectTimer);
      reconnectTimer = null;
    }
    const active = socket;
    socket = null;
    if (active && typeof active.close === 'function') active.close();
    publish('stopped');
  }

  return { start, stop };
}

module.exports = { createWakeRelayClient, relaySocketUrl, RECONNECT_DELAYS_MS };
