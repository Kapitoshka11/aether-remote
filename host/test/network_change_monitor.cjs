const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createNetworkChangeMonitor,
  networkInterfaceSignature
} = require('../lib/network-change-monitor.cjs');

function interfaces(address = '192.168.1.10') {
  return {
    Ethernet: [{
      family: 'IPv4',
      internal: false,
      address,
      netmask: '255.255.255.0',
      mac: 'AA:BB:CC:DD:EE:FF'
    }],
    'vEthernet (WSL)': [{
      family: 'IPv4',
      internal: false,
      address: '172.20.0.1',
      netmask: '255.255.240.0',
      mac: '00:15:5D:00:00:01'
    }]
  };
}

function interfacesWithVpn(vpnAddress = '100.84.2.10') {
  return {
    ...interfaces(),
    'WireGuard Tunnel': [{
      family: 'IPv4',
      internal: false,
      address: vpnAddress,
      netmask: '255.192.0.0',
      mac: '00:00:00:00:00:00'
    }]
  };
}

assert.equal(
  networkInterfaceSignature(interfaces()),
  'Ethernet|192.168.1.10|255.255.255.0|AA:BB:CC:DD:EE:FF'
);
assert.match(
  networkInterfaceSignature(interfacesWithVpn()),
  /WireGuard Tunnel\|100\.84\.2\.10/,
  'VPN interface changes must refresh the endpoint list'
);

let currentInterfaces = interfaces();
let spawnedChild;
let changeCount = 0;
const monitor = createNetworkChangeMonitor({
  platform: 'win32',
  getNetworkInterfaces: () => currentInterfaces,
  debounceMs: 5,
  fallbackIntervalMs: 60_000,
  spawnProcess(command, args, options) {
    assert.equal(command, 'powershell.exe');
    assert.ok(args.includes('-EncodedCommand'));
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; };
    spawnedChild = child;
    return child;
  },
  onChange() { changeCount += 1; }
});

monitor.start();
assert.ok(spawnedChild, 'Windows native network watcher must be started');

spawnedChild.stdout.emit('data', Buffer.from('WATCHER_READY\r\nNETWORK_CHANGED\r\n'));
setTimeout(() => {
  assert.equal(changeCount, 0, 'duplicate OS events without an interface change must be ignored');

  currentInterfaces = interfaces('192.168.50.25');
  spawnedChild.stdout.emit('data', Buffer.from('NETWORK_'));
  spawnedChild.stdout.emit('data', Buffer.from('CHANGED\r\nNETWORK_CHANGED\r\n'));

  setTimeout(() => {
    assert.equal(changeCount, 1, 'a burst of events for one address change must refresh discovery once');
    monitor.stop();
    assert.equal(spawnedChild.killed, true, 'stopping the monitor must stop the native watcher');
    console.log('Network change monitor tests passed.');
  }, 20);
}, 20);
