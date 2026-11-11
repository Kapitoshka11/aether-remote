const assert = require('node:assert/strict');
const {
  isPrivateOrLoopbackHostname,
  isVirtualInterfaceName,
  physicalIpv4Entries,
  advertisableIpv4Entries
} = require('../lib/network-policy.cjs');

for (const host of ['localhost', '127.0.0.1', '127.10.20.30', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.2', '::1']) {
  assert.equal(isPrivateOrLoopbackHostname(host), true, host);
}
for (const host of ['', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.168.evil.example']) {
  assert.equal(isPrivateOrLoopbackHostname(host), false, host);
}
assert.equal(isVirtualInterfaceName('vEthernet (WSL)'), true);
assert.equal(isVirtualInterfaceName('Ethernet'), false);
assert.deepEqual(physicalIpv4Entries({
  Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.2' }],
  'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.1.2' }],
  Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
}).map(item => item.entry.address), ['192.168.1.2']);

const endpointInterfaces = {
  WiFi: [{ family: 'IPv4', internal: false, address: '192.168.1.2', netmask: '255.255.255.0' }],
  'WireGuard Tunnel': [{ family: 'IPv4', internal: false, address: '100.84.2.10', netmask: '255.192.0.0' }],
  slarp0: [{ family: 'IPv4', internal: false, address: '172.19.0.1', netmask: '255.255.255.252' }],
  'vEthernet (WSL)': [{ family: 'IPv4', internal: false, address: '172.20.1.2', netmask: '255.255.240.0' }],
  Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }]
};
assert.deepEqual(
  advertisableIpv4Entries(endpointInterfaces).map(item => [item.name, item.entry.address]),
  [['WiFi', '192.168.1.2'], ['WireGuard Tunnel', '100.84.2.10'], ['slarp0', '172.19.0.1']],
  'explicit pairing must expose physical and VPN endpoints but not VM/container adapters'
);

console.log('Network policy tests passed.');
