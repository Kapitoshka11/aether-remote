const assert = require('node:assert/strict');
const https = require('node:https');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { once } = require('node:events');
const selfsigned = require('selfsigned');
const WebSocket = require('ws');
const { RelayDuplex, MAX_FRAME, WINDOW } = require('../lib/account/relay-duplex.cjs');
const { acceptRelayTlsStream } = require('../lib/account/relay-tls-server.cjs');

(async () => {
  const identity = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    keyType: 'ec', curve: 'P-256', days: 1,
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]
  });
  const expectedPin = crypto.createHash('sha256').update(new crypto.X509Certificate(identity.cert).raw).digest('hex');
  const sessionId = crypto.randomUUID();
  const carrier = new WebSocket.Server({ host: '127.0.0.1', port: 0, maxPayload: MAX_FRAME });
  await once(carrier, 'listening');
  const endpoints = [];
  carrier.on('connection', socket => {
    endpoints.push(socket);
    socket.on('message', (bytes, binary) => {
      const other = endpoints.find(candidate => candidate !== socket);
      if (other?.readyState === 1) other.send(bytes, { binary });
    });
  });
  const outerHost = new WebSocket(`ws://127.0.0.1:${carrier.address().port}`);
  await once(outerHost, 'open');
  const hostDuplex = new RelayDuplex(outerHost);
  hostDuplex.on('error', () => {});
  acceptRelayTlsStream(hostDuplex, sessionId, { key: identity.private, cert: identity.cert }, (socket, request) => {
    assert.equal(request.aetherRelaySessionId, sessionId);
    socket.on('message', (data, binary) => socket.send(data, { binary }));
  });
  const outerPhone = new WebSocket(`ws://127.0.0.1:${carrier.address().port}`);
  await once(outerPhone, 'open');
  const phoneDuplex = new RelayDuplex(outerPhone);
  phoneDuplex.on('error', () => {});
  const tunnelTls = tls.connect({ socket: phoneDuplex, servername: 'localhost', ca: identity.cert,
    checkServerIdentity(host, cert) {
      if (crypto.createHash('sha256').update(cert.raw).digest('hex') !== expectedPin) return new Error('pin_mismatch');
      return tls.checkServerIdentity(host, cert);
    } });
  const timeout = setTimeout(() => { console.error('TLS relay prototype timed out'); process.exit(1); }, 20000);
  try {
    await once(tunnelTls, 'secureConnect');
    const socket = new WebSocket(`wss://localhost/account-relay/${sessionId}`, { createConnection: () => tunnelTls });
    await once(socket, 'open');
    const textReply = once(socket, 'message');
    socket.send(JSON.stringify({ action: 'PING', id: 1 }));
    assert.deepEqual(JSON.parse(String((await textReply)[0])), { action: 'PING', id: 1 });
    const bytes = crypto.randomBytes(1024 * 1024);
    const binaryReply = once(socket, 'message');
    socket.send(bytes);
    const [result, binary] = await binaryReply;
    assert.equal(binary, true);
    assert.deepEqual(result, bytes);
    assert.ok(phoneDuplex.sent > 1024 * 1024);
    assert.ok(phoneDuplex.sent - phoneDuplex.acked <= WINDOW);
    console.log('TLS over relay: encrypted WSS JSON and 1 MiB binary round-trip passed with bounded credit');
    socket.terminate();
  } finally {
    clearTimeout(timeout);
    tunnelTls.destroy(); hostDuplex.destroy(); phoneDuplex.destroy();
    for (const socket of endpoints) socket.terminate();
    carrier.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
