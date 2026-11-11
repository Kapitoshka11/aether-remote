const assert = require('node:assert/strict');
const {
  normalizeMac,
  buildMagicPacket,
  ipv4Broadcast,
  collectBroadcastTargets,
  sendMagicPacket
} = require('../lib/wake/magic-packet.cjs');

assert.equal(normalizeMac('AA:bb:01:02:fe:FF'), 'aabb0102feff');
assert.equal(normalizeMac('AA-BB-01-02-FE-FF'), 'aabb0102feff');
assert.throws(() => normalizeMac(''), /invalid_mac/);
assert.throws(() => normalizeMac('zz:bb:01:02:03:04'), /invalid_mac/);

const packet = buildMagicPacket('aa:bb:01:02:fe:ff');
assert.equal(packet.length, 102);
assert.equal(packet.subarray(0, 6).toString('hex'), 'ffffffffffff');
assert.equal(packet.subarray(6).toString('hex'), 'aabb0102feff'.repeat(16));

assert.equal(ipv4Broadcast('192.168.1.42', '255.255.255.0'), '192.168.1.255');
assert.equal(ipv4Broadcast('10.20.30.40', '255.255.0.0'), '10.20.255.255');
assert.throws(() => ipv4Broadcast('not-an-ip', '255.255.255.0'), /invalid_ipv4/);

assert.deepEqual(collectBroadcastTargets({
  Ethernet: [
    { family: 'IPv4', internal: false, address: '192.168.1.42', netmask: '255.255.255.0' },
    { family: 'IPv4', internal: false, address: '192.168.1.43', netmask: '255.255.255.0' }
  ],
  Vpn: [{ family: 4, internal: false, address: '10.20.30.40', netmask: '255.255.0.0' }],
  'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.1.5', netmask: '255.255.240.0' }],
  VirtualBox: [{ family: 'IPv4', internal: false, address: '192.168.56.1', netmask: '255.255.255.0' }],
  Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
  Ipv6: [{ family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::' }]
}), ['10.20.255.255', '192.168.1.255', '255.255.255.255']);

async function run() {
  const sent = [];
  let closed = false;
  await sendMagicPacket({
    mac: 'aa:bb:01:02:fe:ff',
    targets: ['192.168.1.255', '255.255.255.255'],
    repeat: 3,
    udpFactory: () => ({
      bind: callback => callback(),
      setBroadcast: enabled => assert.equal(enabled, true),
      send: (payload, port, target, callback) => {
        sent.push({ hex: payload.toString('hex'), port, target });
        callback(null);
      },
      close: () => { closed = true; }
    }),
    delay: async () => {}
  });

  assert.equal(sent.length, 6);
  assert.deepEqual([...new Set(sent.map(item => item.target))], ['192.168.1.255', '255.255.255.255']);
  assert.equal(sent.every(item => item.port === 9 && item.hex.length === 204), true);
  assert.equal(closed, true);
  console.log('Wake Magic Packet tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
