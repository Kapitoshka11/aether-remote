const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createIdentity } = require('../lib/account/protocol.cjs');
const { connectRelay, canonicalRelayJoin } = require('../lib/account/relay-client.cjs');

(async () => {
  const identity = createIdentity(), ownerId = crypto.randomUUID(), sessionId = crypto.randomUUID();
  const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  let mode = 'valid';
  server.on('connection', (socket, request) => {
    assert.equal(request.headers.authorization, 'Bearer test-token');
    assert.equal(request.url, `/v1/connect/${sessionId}/host`);
    const challenge = { type: 'challenge', ownerId, sessionId, deviceId: identity.id,
      role: mode === 'wrong-role' ? 'phone' : 'host', nonce: crypto.randomBytes(32).toString('base64url'), expiresAt: Date.now() + 15000 };
    let signed = false;
    socket.on('message', (data, binary) => {
      if (!signed) {
        assert.equal(binary, false);
        assert.equal(crypto.verify('sha256', canonicalRelayJoin(challenge), crypto.createPublicKey(identity.privateKeyPem),
          Buffer.from(JSON.parse(String(data)).signature, 'base64url')), true);
        signed = true;
        socket.send(JSON.stringify({ type: 'ready', expiresAt: Date.now() + 60000 }));
      } else if (data[0] === 0) {
        const ack = Buffer.alloc(5); ack[0] = 1; ack.writeUInt32BE(data.readUInt32BE(1) + data.length - 5, 1);
        socket.send(ack); socket.send(data);
      }
    });
    if (mode !== 'silent') socket.send(JSON.stringify(challenge));
  });
  const options = { url: `ws://127.0.0.1:${server.address().port}`, ownerId, sessionId, identity,
    accessToken: 'test-token', allowLocalTest: true };
  let stream;
  try {
    assert.throws(() => connectRelay({ ...options, allowLocalTest: false }), /invalid_relay_url/);
    stream = await connectRelay(options);
    stream.on('error', () => {});
    const echo = once(stream, 'data');
    stream.write(Buffer.from('encrypted transport bytes'));
    assert.equal(String((await echo)[0]), 'encrypted transport bytes');
    stream.destroy();
    mode = 'wrong-role';
    await assert.rejects(connectRelay(options), /relay_authentication_failed/);
    mode = 'silent';
    const abort = new AbortController();
    const joining = connectRelay({ ...options, signal: abort.signal });
    abort.abort();
    await assert.rejects(joining, /relay_(unavailable|closed)/);
    console.log('account relay client: signed join, transport data, role binding, cancellation and WSS enforcement passed');
  } finally {
    stream?.destroy();
    for (const socket of server.clients) socket.terminate();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
