const crypto = require('node:crypto');
const WebSocket = require('ws');
const { RelayDuplex, MAX_FRAME } = require('./relay-duplex.cjs');

function canonicalRelayJoin(value) {
  if (![value.ownerId, value.sessionId].every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) ||
      !['host', 'phone'].includes(value.role) || !/^[0-9a-f]{64}$/.test(value.deviceId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) || !Number.isSafeInteger(value.expiresAt)) throw new Error('invalid_relay_challenge');
  return Buffer.from(['AETHER_RELAY_JOIN_V1', value.ownerId, value.sessionId, value.role,
    value.deviceId, value.nonce, value.expiresAt].join('\n'));
}

function connectRelay({ url, ownerId, sessionId, identity, accessToken, role = 'host', signal, allowLocalTest = false }) {
  const endpoint = new URL(url);
  if ((endpoint.protocol !== 'wss:' && !(allowLocalTest && endpoint.protocol === 'ws:' && endpoint.hostname === '127.0.0.1')) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      !/^[0-9a-f-]{36}$/.test(sessionId) || !['host', 'phone'].includes(role)) throw new Error('invalid_relay_url');
  endpoint.pathname = `/v1/connect/${sessionId}/${role}`;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('relay_cancelled')); return; }
    const socket = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${accessToken}` },
      followRedirects: false, handshakeTimeout: 10000, maxPayload: MAX_FRAME });
    let settled = false, signed = false;
    const abort = () => socket.terminate();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { socket.terminate(); fail('relay_join_timeout'); }, 20000);
    timeout.unref();
    function fail(code) {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(code)); }
    }
    const onMessage = (raw, binary) => {
      try {
        if (binary || raw.length > 2048) throw new Error();
        const message = JSON.parse(String(raw));
        if (message.type === 'challenge') {
          if (signed || message.ownerId !== ownerId || message.sessionId !== sessionId ||
              message.deviceId !== identity.id || message.role !== role || message.expiresAt <= Date.now() || message.expiresAt > Date.now() + 30000) throw new Error();
          const signature = crypto.sign('sha256', canonicalRelayJoin(message), identity.privateKeyPem).toString('base64url');
          signed = true;
          socket.send(JSON.stringify({ type: 'proof', signature }));
        } else if (message.type === 'ready') {
          if (!signed || settled || !Number.isSafeInteger(message.expiresAt) || message.expiresAt <= Date.now()) throw new Error();
          settled = true;
          clearTimeout(timeout);
          socket.removeListener('message', onMessage);
          const duplex = new RelayDuplex(socket);
          resolve(duplex);
        } else throw new Error();
      } catch { socket.terminate(); fail('relay_authentication_failed'); }
    };
    socket.on('message', onMessage);
    socket.on('error', () => fail('relay_unavailable'));
    socket.once('close', () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      fail('relay_closed');
    });
  });
}

module.exports = { canonicalRelayJoin, connectRelay };
