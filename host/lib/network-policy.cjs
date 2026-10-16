const net = require('node:net');

const VIRTUAL_INTERFACE_PATTERN = /(vEthernet|VirtualBox|VMware|WSL|Loopback|TAP|Tun|Hyper-V|docker)/i;
const NON_ADVERTISABLE_INTERFACE_PATTERN = /(vEthernet|VirtualBox|VMware|WSL|Loopback|Hyper-V|docker|Default Switch)/i;

function isVirtualInterfaceName(name) {
  return VIRTUAL_INTERFACE_PATTERN.test(String(name || ''));
}

function isPrivateOrLoopbackHostname(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost') return true;
  const version = net.isIP(host);
  if (version === 6) return host === '::1';
  if (version !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

function physicalIpv4Entries(networkInterfaces) {
  const result = [];
  for (const [name, entries] of Object.entries(networkInterfaces || {})) {
    if (isVirtualInterfaceName(name)) continue;
    for (const entry of entries || []) {
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4)) continue;
      result.push({ name, entry });
    }
  }
  return result;
}

function advertisableIpv4Entries(networkInterfaces) {
  const result = [];
  const seenAddresses = new Set();
  for (const [name, entries] of Object.entries(networkInterfaces || {})) {
    if (NON_ADVERTISABLE_INTERFACE_PATTERN.test(String(name || ''))) continue;
    for (const entry of entries || []) {
      if (entry.internal || (entry.family !== 'IPv4' && entry.family !== 4)) continue;
      const address = String(entry.address || '');
      if (!net.isIPv4(address) || address.startsWith('127.') || address.startsWith('169.254.') || seenAddresses.has(address)) continue;
      seenAddresses.add(address);
      result.push({ name, entry });
    }
  }
  return result;
}

module.exports = {
  VIRTUAL_INTERFACE_PATTERN,
  isVirtualInterfaceName,
  isPrivateOrLoopbackHostname,
  physicalIpv4Entries,
  advertisableIpv4Entries
};
