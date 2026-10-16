const assert = require('node:assert/strict');
const { WebSocketServer, WebSocket } = require('ws');
const { createObsClient, validateObsWebSocketUrl } = require('../lib/aether-deck/obs-client.cjs');
const { createObsProvider } = require('../lib/aether-deck/providers/obs.cjs');

async function run() {
  assert.equal(validateObsWebSocketUrl('ws://127.0.0.1:4455'), true);
  assert.equal(validateObsWebSocketUrl('wss://192.168.1.25:4455'), true);
  assert.equal(validateObsWebSocketUrl('ws://192.168.evil.example:4455'), false);
  assert.equal(validateObsWebSocketUrl('ws://8.8.8.8:4455'), false);
  assert.equal(validateObsWebSocketUrl('https://127.0.0.1:4455'), false);
  assert.equal(validateObsWebSocketUrl('ws://user:pass@127.0.0.1:4455'), false);
  assert.equal(validateObsWebSocketUrl('ws://127.0.0.1:4455/?target=internal'), false);

  const server = new WebSocketServer({ port: 0 });
  const port = server.address().port;
  server.on('connection', socket => {
    socket.send('not-json');
    socket.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1 } }));
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.op === 1) {
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
        socket.send(JSON.stringify({ op: 5, d: { eventType: 'StreamStateChanged', eventData: { outputActive: true } } }));
      }
      if (message.op === 6) {
        socket.send(JSON.stringify({ op: 7, d: { requestType: message.d.requestType, requestId: message.d.requestId, requestStatus: { result: true, code: 100 }, responseData: { currentProgramSceneName: 'Main' } } }));
      }
    });
  });
  const states = {};
  const client = createObsClient({ WebSocketImpl: WebSocket, url: `ws://127.0.0.1:${port}`, password: '' });
  const dispose = client.subscribe(patch => Object.assign(states, patch));
  try {
    await client.connect();
    const scenes = await client.request('GetSceneList', {});
    assert.equal(scenes.currentProgramSceneName, 'Main');
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(states['obs.streaming'], true);
    assert.equal(states['obs.lastProtocolError'], 'Malformed OBS WebSocket message ignored');
    const provider = createObsProvider({ client });
    await provider.execute({ type: 'obs.scene.set', parameters: { sceneName: 'Main' } });
    assert.equal(provider.actions.some(action => action.type === 'obs.replay.save'), true);
  } finally {
    dispose();
    client.disconnect();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Aether Deck OBS tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
