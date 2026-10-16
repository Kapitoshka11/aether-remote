function normalizeMac(value) {
  const normalized = String(value || '').replace(/[:-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(normalized)) throw new Error('invalid_mac');
  return normalized;
}

function buildMagicPacket(mac) {
  const macBytes = Buffer.from(normalizeMac(mac), 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => macBytes)]);
}

function parseIpv4(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error('invalid_ipv4');
  }
  return parts.map(Number);
}

function ipv4Broadcast(address, netmask) {
  const addressBytes = parseIpv4(address);
  const maskBytes = parseIpv4(netmask);
  return addressBytes.map((byte, index) => (byte | (~maskBytes[index] & 0xff))).join('.');
}

function isPrivateIpv4(address) {
  const [a, b] = parseIpv4(address);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function collectBroadcastTargets(networkInterfaces) {
  const targets = new Set();
  for (const { entry } of physicalIpv4Entries(networkInterfaces)) {
    if (!isPrivateIpv4(entry.address)) continue;
    targets.add(ipv4Broadcast(entry.address, entry.netmask));
  }
  targets.add('255.255.255.255');
  return [...targets].sort();
}

async function sendMagicPacket({
  mac,
  targets,
  port = 9,
  repeat = 3,
  udpFactory = () => require('node:dgram').createSocket('udp4'),
  delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
}) {
  if (!Array.isArray(targets) || targets.length === 0) throw new Error('no_broadcast_targets');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_port');
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error('invalid_repeat');
  const payload = buildMagicPacket(mac);
  const socket = udpFactory();
  try {
    await new Promise((resolve, reject) => {
      socket.once?.('error', reject);
      socket.bind(() => {
        try {
          socket.setBroadcast(true);
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    for (let attempt = 0; attempt < repeat; attempt += 1) {
      for (const target of targets) {
        await new Promise((resolve, reject) => {
          socket.send(payload, port, target, error => error ? reject(error) : resolve());
        });
      }
      if (attempt + 1 < repeat) await delay(75);
    }
  } finally {
    socket.close();
  }
}

module.exports = {
  normalizeMac,
  buildMagicPacket,
  ipv4Broadcast,
  collectBroadcastTargets,
  sendMagicPacket
};
const { physicalIpv4Entries } = require('../network-policy.cjs');
