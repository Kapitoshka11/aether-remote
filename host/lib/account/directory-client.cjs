const { deviceId, verifyGrant } = require('./protocol.cjs');
const net = require('node:net');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isSafeIpv4Endpoint(value) {
  if (typeof value !== 'string' || !net.isIPv4(value)) return false;
  const [first, second] = value.split('.').map(Number);
  return first > 0 && first < 224 && first !== 127 && !(first === 169 && second === 254);
}

function parseNetworkEndpoints(row) {
  const value = row.network_endpoints == null ? [] : row.network_endpoints;
  if (!Array.isArray(value) || value.length > 16 || value.some(item => !isSafeIpv4Endpoint(item))) {
    throw new Error('invalid_account_device');
  }
  return [...new Set(value)];
}

function checked(result) {
  if (result.error) throw new Error('account_directory_unavailable');
  return result.data;
}

function parseDevice(row) {
  if (!row || !UUID.test(row.owner_id) || deviceId(row.public_key_spki) !== row.id ||
      !['host', 'phone'].includes(row.kind) || typeof row.name !== 'string' ||
      row.name.trim().length < 1 || row.name.length > 80 || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535 ||
      (row.kind === 'host' && !/^[0-9a-f]{64}$/.test(row.tls_fingerprint))) throw new Error('invalid_account_device');
  const networkEndpoints = parseNetworkEndpoints(row);
  return { ownerId: row.owner_id, id: row.id, kind: row.kind, name: row.name,
    publicKeySpki: row.public_key_spki, tlsFingerprint: row.tls_fingerprint,
    lanIp: row.lan_ip, networkEndpoints, port: row.port, lastSeenAt: row.last_seen_at, revokedAt: row.revoked_at };
}

function grantToRow(grant) {
  return { owner_id: grant.ownerId, id: grant.grantId, host_id: grant.hostId, phone_id: grant.phoneId,
    revision: grant.revision, phone_public_key_spki: grant.phonePublicKeySpki,
    host_tls_fingerprint: grant.hostTlsFingerprint, issued_at: grant.issuedAt, signature: grant.signature };
}

function grantFromRow(row) {
  return { version: 1, permissions: 'control', ownerId: row.owner_id, grantId: row.id,
    hostId: row.host_id, phoneId: row.phone_id, revision: row.revision,
    phonePublicKeySpki: row.phone_public_key_spki, hostTlsFingerprint: row.host_tls_fingerprint,
    issuedAt: row.issued_at, signature: row.signature };
}

class DirectoryClient {
  constructor(client, ownerId) {
    if (!UUID.test(ownerId)) throw new Error('invalid_account_owner');
    this.client = client;
    this.ownerId = ownerId;
  }
  async devices() {
    const rows = checked(await this.client.from('aether_devices').select('*').eq('owner_id', this.ownerId).limit(256));
    return rows.map(parseDevice).filter(device => device.ownerId === this.ownerId);
  }
  async register(identity, { kind, name, tlsFingerprint = null, lanIp = null, networkEndpoints = [], port = 8080 }) {
    if (!Array.isArray(networkEndpoints) || networkEndpoints.length > 16 ||
        networkEndpoints.some(endpoint => !isSafeIpv4Endpoint(endpoint))) throw new Error('invalid_network_endpoints');
    networkEndpoints = [...new Set(networkEndpoints)];
    const existing = checked(await this.client.from('aether_devices').select('*')
      .eq('owner_id', this.ownerId).eq('id', identity.id).maybeSingle());
    if (existing) {
      const device = parseDevice(existing);
      if (device.revokedAt || device.kind !== kind || device.tlsFingerprint !== tlsFingerprint) throw new Error('account_device_revoked_or_changed');
      return this.heartbeat(identity.id, lanIp, networkEndpoints, port);
    }
    checked(await this.client.from('aether_devices').insert({ owner_id: this.ownerId, id: identity.id,
      kind, name, public_key_spki: identity.publicKeySpki, tls_fingerprint: tlsFingerprint,
      lan_ip: lanIp, network_endpoints: networkEndpoints, port }));
  }
  async heartbeat(id, lanIp, networkEndpoints, port) {
    const rows = checked(await this.client.from('aether_devices').update({
      last_seen_at: new Date().toISOString(), lan_ip: lanIp, network_endpoints: networkEndpoints, port
    })
      .eq('owner_id', this.ownerId).eq('id', id).is('revoked_at', null).select('id'));
    if (rows.length !== 1) throw new Error('account_device_revoked_or_missing');
  }
  async rename(id, name) {
    if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) throw new Error('invalid_device_name');
    const rows = checked(await this.client.from('aether_devices').update({ name: name.trim() })
      .eq('owner_id', this.ownerId).eq('id', id).is('revoked_at', null).select('id'));
    if (rows.length !== 1) throw new Error('account_device_revoked_or_missing');
  }
  async revokeDevice(id) {
    checked(await this.client.from('aether_devices').update({ revoked_at: new Date().toISOString() })
      .eq('owner_id', this.ownerId).eq('id', id).is('revoked_at', null));
  }
  async grants(devices) {
    const rows = checked(await this.client.from('aether_grants').select('*').eq('owner_id', this.ownerId).limit(2048));
    return rows.flatMap(row => {
      const grant = grantFromRow(row);
      const host = devices.find(d => d.id === grant.hostId && d.kind === 'host');
      if (grant.ownerId !== this.ownerId || !host || !verifyGrant(grant, host.publicKeySpki)) return [];
      return [{ grant, revokedAt: row.revoked_at }];
    });
  }
  async publishGrant(grant) {
    if (grant.ownerId !== this.ownerId) throw new Error('account_owner_mismatch');
    // A duplicate retry may only preserve an existing immutable grant.
    checked(await this.client.from('aether_grants').upsert(grantToRow(grant), { onConflict: 'owner_id,id', ignoreDuplicates: true }));
  }
  async sessions(hostId) {
    return checked(await this.client.from('aether_sessions').select('*').eq('owner_id', this.ownerId)
      .eq('host_id', hostId).eq('state', 'pending').gt('expires_at', new Date().toISOString()).limit(8));
  }
}

module.exports = { DirectoryClient, parseDevice, grantToRow, grantFromRow, isSafeIpv4Endpoint };
