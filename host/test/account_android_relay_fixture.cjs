// Local integration fixture: cloud authorization is mocked; both TLS layers and device signatures are real.
const https = require('node:https');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { EventEmitter } = require('node:events');
const selfsigned = require('selfsigned');
const WebSocket = require('ws');
const { RelayDuplex, MAX_FRAME } = require('../lib/account/relay-duplex.cjs');
const { canonicalRelayJoin } = require('../lib/account/relay-client.cjs');
const { acceptRelayTlsStream } = require('../lib/account/relay-tls-server.cjs');

readline.createInterface({ input: process.stdin }).once('line', async line => {
  try {
    const config = JSON.parse(line);
    const identity = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }],
      { keyType: 'ec', curve: 'P-256', days: 1 });
    const server = https.createServer({ key: identity.private, cert: identity.cert });
    const sockets = new WebSocket.Server({ server, maxPayload: MAX_FRAME });
    sockets.on('connection', (phone, request) => {
      if (request.headers.authorization !== 'Bearer integration-test-token' ||
          request.url !== `/v1/connect/${config.sessionId}/phone`) { phone.close(1008); return; }
      const challenge = { type: 'challenge', ownerId: config.ownerId, sessionId: config.sessionId,
        role: 'phone', deviceId: config.deviceId, nonce: crypto.randomBytes(32).toString('base64url'), expiresAt: Date.now() + 15000 };
      const carrier = new EventEmitter();
      carrier.readyState = 1;
      carrier.bufferedAmount = 0;
      carrier.send = (data, options, callback) => phone.send(data, options, callback);
      carrier.terminate = carrier.close = () => { if (carrier.readyState === 1) { carrier.readyState = 3; phone.terminate(); carrier.emit('close'); } };
      let proved = false;
      phone.on('close', () => carrier.close());
      phone.on('error', () => carrier.close());
      phone.on('message', (data, binary) => {
        try {
          if (proved) { carrier.emit('message', data, binary); return; }
          if (binary || data.length > 2048) throw new Error();
          const message = JSON.parse(String(data));
          const key = crypto.createPublicKey({ key: Buffer.from(config.publicKeySpki, 'base64'), format: 'der', type: 'spki' });
          if (message.type !== 'proof' || !crypto.verify('sha256', canonicalRelayJoin(challenge), key,
            Buffer.from(message.signature, 'base64url'))) throw new Error();
          proved = true;
          const stream = new RelayDuplex(carrier);
          stream.on('error', () => {});
          acceptRelayTlsStream(stream, config.sessionId, { key: identity.private, cert: identity.cert },
            socket => socket.on('message', (bytes, isBinary) => socket.send(bytes, { binary: isBinary })));
          phone.send(JSON.stringify({ type: 'ready', expiresAt: Date.now() + 60000 }));
        } catch { carrier.close(); }
      });
      phone.send(JSON.stringify(challenge));
    });
    server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: server.address().port,
      fingerprint: crypto.createHash('sha256').update(new crypto.X509Certificate(identity.cert).raw).digest('hex') }) + '\n'));
    setTimeout(() => process.exit(0), 60000).unref();
  } catch { process.stderr.write('Local relay fixture failed\n'); process.exit(1); }
});
