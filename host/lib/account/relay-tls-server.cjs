const https = require('node:https');
const WebSocket = require('ws');

function acceptRelayTlsStream(stream, sessionId, identity, onConnection) {
  // This server never listens on a port. Its request metadata belongs to exactly one outer session.
  const server = https.createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.2' },
    (_request, response) => { response.writeHead(404); response.end(); });
  const sockets = new WebSocket.Server({ server, maxPayload: 1024 * 1024 });
  sockets.on('connection', (socket, request) => {
    if (request.url !== `/account-relay/${sessionId}`) { socket.close(1008, 'Account endpoint required'); return; }
    request.aetherRelaySessionId = sessionId;
    onConnection(socket, request);
  });
  stream.once('close', () => {
    for (const socket of sockets.clients) socket.terminate();
    sockets.close();
    server.close();
  });
  server.emit('connection', stream);
}

module.exports = { acceptRelayTlsStream };
