const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWakeRelayClient } = require('../lib/wake/relay-client.cjs');

class FakeSocket extends EventEmitter {
  static OPEN = 1;

  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.closed = false;
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.closed = true;
    this.readyState = 3;
    this.emit('close', 1000, Buffer.from('closed'));
  }
}

async function run() {
  const sockets = [];
  const scheduled = [];
  const states = [];
  const delivered = [];
  const certificate = { type: 'wake.membership', deviceId: '11'.repeat(16), signature: 'sig+/=' };
  const client = createWakeRelayClient({
    WebSocketImpl: class extends FakeSocket {
      constructor(url) {
        super(url);
        sockets.push(this);
      }
    },
    relayUrl: 'https://relay.example',
    groupId: '22'.repeat(16),
    deviceId: certificate.deviceId,
    certificate,
    presenceDeviceId: '55'.repeat(16),
    bridge: { deliver: async message => {
      delivered.push(message);
      return { status: 'delivered', code: 'sent', deliveredAt: 1_700_000_000_000 };
    } },
    onState: state => states.push(state),
    setTimeoutImpl: (callback, delay) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    },
    clearTimeoutImpl: () => {},
    random: () => 0,
    clock: () => 1_700_000_000_000
  });

  client.start();
  assert.equal(sockets.length, 1);
  assert.equal(new URL(sockets[0].url).pathname, `/v1/groups/${'22'.repeat(16)}/socket`);
  assert.equal(new URL(sockets[0].url).searchParams.get('deviceId'), certificate.deviceId);
  assert.deepEqual(JSON.parse(Buffer.from(new URL(sockets[0].url).searchParams.get('certificate'), 'base64url')), certificate);
  sockets[0].open();
  assert.equal(states.at(-1).status, 'connected');
  assert.deepEqual(sockets[0].sent[0], {
    version: 1,
    type: 'host.online',
    deviceId: '55'.repeat(16),
    onlineAt: 1_700_000_000_000
  });

  sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'wake.request', nonce: '33'.repeat(16), targetDeviceId: '44'.repeat(16) })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered.length, 1);
  assert.deepEqual(sockets[0].sent[1], {
    type: 'wake.delivery',
    nonce: '33'.repeat(16),
    targetDeviceId: '44'.repeat(16),
    status: 'delivered',
    code: 'sent',
    deliveredAt: 1_700_000_000_000
  });

  sockets[0].emit('close', 1006, Buffer.from('network'));
  assert.equal(scheduled[0].delay, 1000);
  scheduled.shift().callback();
  assert.equal(sockets.length, 2);
  sockets[1].emit('close', 1006, Buffer.from('network'));
  assert.equal(scheduled[0].delay, 2000);

  client.stop();
  const before = scheduled.length;
  sockets[1].emit('close', 1006, Buffer.from('network'));
  assert.equal(scheduled.length, before);

  console.log('Wake Relay client tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
