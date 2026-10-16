const { EventEmitter } = require('node:events');
const path = require('node:path');
const crypto = require('node:crypto');
const { AccountAuth } = require('./auth-client.cjs');
const { createSecureStore, loadIdentity } = require('./secure-store.cjs');
const { createTrustStore } = require('./trust-store.cjs');
const { DirectoryClient } = require('./directory-client.cjs');
const { AuthChallenge, signGrant, canonicalProof } = require('./protocol.cjs');
const { AccountRelayHost } = require('./relay-host.cjs');
const config = require('./config.cjs');

class AccountHostService extends EventEmitter {
  static async create({ userData, safeStorage, getHost, requestApproval, acceptRelayStream }) {
    const storage = await createSecureStore({ filePath: path.join(userData, 'account-v1.bin'), safeStorage });
    const identity = await loadIdentity(storage);
    const cached = await storage.getItem('aether-supabase-auth-v1');
    const user = cached ? JSON.parse(cached)?.user : null;
    const initialProfile = user && /^[0-9a-f-]{36}$/.test(user.id) && user.email_confirmed_at ?
      { id: user.id, email: String(user.email || ''), confirmed: true } : null;
    return new AccountHostService({ storage, identity, getHost, requestApproval, initialProfile, acceptRelayStream });
  }
  constructor({ storage, identity, getHost, requestApproval, initialProfile = null, acceptRelayStream,
    authFactory = options => new AccountAuth(options), directoryFactory = (client, owner) => new DirectoryClient(client, owner) }) {
    super();
    Object.assign(this, { storage, identity, getHost, requestApproval, acceptRelayStream });
    this.relay = null;
    this.directoryFactory = directoryFactory;
    this.auth = authFactory({ storage, initialProfile });
    this.ownerId = initialProfile?.id ?? null;
    this.generation = 0;
    this.trust = null;
    this.directory = null;
    this.devices = [];
    this.sockets = new Map();
    this.online = false;
    this.refreshing = null;
    this.auth.on('change', snapshot => {
      const owner = snapshot.profile?.id ?? null;
      if (owner !== this.ownerId) {
        this.generation++;
        this.closeAccountSockets();
        this.ownerId = owner;
        this.trust = null;
        this.directory = null;
        this.devices = [];
        this.online = false;
        void this.refresh().catch(() => {});
      }
      this.emit('change', this.snapshot());
    });
    this.timer = setInterval(() => { void this.refresh().catch(() => {}); }, 45000);
    this.timer.unref();
    queueMicrotask(() => { void this.refresh().catch(() => {}); });
  }
  snapshot() {
    const revoked = new Set(this.trust?.revokedDevices() || []);
    const trusted = new Set((this.trust?.list() || []).filter(grant => this.trust.isAllowed(grant)).map(grant => grant.phoneId));
    return { ...this.auth.snapshot(), devices: this.devices.map(device => ({ ...device,
      trustedHere: device.kind === 'phone' && trusted.has(device.id),
      revokedAt: device.revokedAt || (revoked.has(device.id) ? 'local' : null) })), deviceId: this.identity.id,
      publicKeySpki: this.identity.publicKeySpki, online: this.online };
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    const generation = this.generation;
    this.refreshing = this.refreshNow().finally(() => {
      this.refreshing = null;
      if (generation !== this.generation && !this.disposed) void this.refresh().catch(() => {});
    });
    return this.refreshing;
  }
  async refreshNow() {
    const owner = this.ownerId, generation = this.generation;
    if (!owner) return;
    const current = () => owner === this.ownerId && generation === this.generation;
    if (!this.trust) {
      const trust = await createTrustStore(this.storage, this.identity, owner);
      if (!current()) return;
      this.trust = trust;
      this.directory = this.directoryFactory(this.auth.client, owner);
    }
    const directory = this.directory, trust = this.trust;
    try {
      const host = this.getHost();
      if (!host.tlsFingerprint) return;
      let devices = await directory.devices();
      const grants = await directory.grants(devices);
      if (!current()) return;
      await trust.mergeRevocations(devices, grants);
      if (!current()) return;
      this.devices = devices;
      for (const device of devices) if (device.revokedAt) this.relay?.revoke(device.id);
      for (const [socket, record] of this.sockets) {
        if (record.authenticatedGrant && !trust.isAllowed(record.authenticatedGrant)) socket.close(1008, 'Account device revoked');
      }
      for (const id of trust.pendingRevocations()) {
        await directory.revokeDevice(id);
        if (!current()) return;
        await trust.acknowledgeRevocation(id);
      }
      if (trust.revokedDevices().includes(this.identity.id)) throw new Error('account_device_revoked');
      await directory.register(this.identity, { kind: 'host', name: host.name,
        tlsFingerprint: host.tlsFingerprint, lanIp: host.lanIp,
        networkEndpoints: host.networkEndpoints || [], port: host.port });
      if (!current()) return;
      if (!devices.some(d => d.id === this.identity.id)) devices = await directory.devices();
      if (!current()) return;
      this.devices = devices;
      this.online = true;
      if (!this.relay && config.relayUrl && this.acceptRelayStream) {
        this.relay = new AccountRelayHost({ client: this.auth.client, directory, ownerId: owner,
          identity: this.identity, url: config.relayUrl, acceptStream: this.acceptRelayStream });
      }
    } catch {
      if (current()) this.online = false;
    } finally { if (current()) this.emit('change', this.snapshot()); }
  }
  closeAccountSockets() {
    this.relay?.dispose();
    this.relay = null;
    for (const [socket, record] of this.sockets) { record.challenge?.clear(); socket.close(1008, 'Account changed'); }
    this.sockets.clear();
  }
  async signOut() {
    if (this.auth.busy) return { ok: false, message: 'Сначала завершите или отмените вход.' };
    this.generation++;
    this.closeAccountSockets();
    if (this.trust) await this.trust.clear();
    return this.auth.signOut();
  }
  async rename(id, name) {
    if (!this.directory) throw new Error('account_signed_out');
    await this.directory.rename(id, name);
    await this.refresh();
  }
  async revoke(id) {
    if (!this.directory || !this.trust || !/^[0-9a-f]{64}$/.test(id)) throw new Error('account_signed_out');
    await this.trust.revokeDevice(id);
    this.relay?.revoke(id);
    for (const [socket, record] of this.sockets) if (id === this.identity.id || record.phoneId === id) socket.close(1008, 'Account device revoked');
    this.emit('change', this.snapshot());
    await this.refresh();
  }
  async handle(socket, message, onAuthenticated) {
    if (!message.action?.startsWith('ACCOUNT_')) return false;
    const send = data => { if (socket.readyState === 1) socket.send(JSON.stringify(data)); };
    const reject = () => { send({ status: 'AUTH_REJECTED', error: 'Аккаунтное подключение отклонено.' }); socket.close(1008, 'Account authentication rejected'); };
    if (socket.isAuth || !this.ownerId || !this.trust) { reject(); return true; }
    let record = this.sockets.get(socket);
    if (record?.busy) { reject(); return true; }
    if (!record) {
      if (this.sockets.size >= 16) { reject(); return true; }
      record = { generation: this.generation, phoneId: message.phoneId, busy: false, challenge: null };
      this.sockets.set(socket, record);
      record.timeout = setTimeout(() => { record.challenge?.clear(); socket.close(1008, 'Account authentication timeout'); }, 65000);
      record.timeout.unref();
      socket.once('close', () => { clearTimeout(record.timeout); record.challenge?.clear(); this.sockets.delete(socket); });
    }
    record.busy = true;
    const current = () => record.generation === this.generation && this.sockets.get(socket) === record && socket.readyState === 1;
    try {
      if (message.action === 'ACCOUNT_HELLO') {
        if (record.challenge || message.ownerId !== this.ownerId || message.hostId !== this.identity.id ||
            !/^[0-9a-f]{64}$/.test(message.phoneId) || !/^[0-9a-f-]{36}$/.test(message.sessionId)) throw new Error();
        record.phoneId = message.phoneId;
        if (socket.accountTransport === 'relay' && (socket.relaySessionId !== message.sessionId ||
            !this.relay?.matches(message.sessionId, message.phoneId))) throw new Error();
        let grant = this.trust.find(message.phoneId, message.grantId);
        record.enrolling = !grant;
        if (!grant) {
          if (!this.online || typeof message.accessToken !== 'string' || message.accessToken.length > 16384) throw new Error();
          const user = await this.auth.client.auth.getUser(message.accessToken);
          if (!current() || user.error || user.data.user?.id !== this.ownerId || !user.data.user.email_confirmed_at) throw new Error();
          const devices = await this.directory.devices();
          if (!current()) throw new Error();
          const phone = devices.find(d => d.id === message.phoneId && d.kind === 'phone' && !d.revokedAt);
          const own = devices.find(d => d.id === this.identity.id && !d.revokedAt);
          if (!phone || !own) throw new Error();
          record.phone = phone;
          grant = signGrant({ ownerId: this.ownerId, hostId: this.identity.id, phoneId: phone.id,
            phonePublicKeySpki: phone.publicKeySpki, hostTlsFingerprint: this.getHost().tlsFingerprint,
            grantId: crypto.randomUUID(), issuedAt: Date.now(), revision: 1 }, this.identity.privateKeyPem);
        }
        record.grant = grant;
        record.challenge = new AuthChallenge({ isAllowed: candidate => current() &&
          (record.enrolling ? candidate.grantId === record.grant.grantId : this.trust.isAllowed(candidate)) });
        const challenge = record.challenge.issue(grant, message.sessionId, socket.accountTransport === 'relay' ? 'relay' : 'lan');
        record.approvalCode = crypto.createHash('sha256').update(canonicalProof(challenge)).update(this.identity.publicKeySpki).digest().readUInt32BE(0) % 1000000;
        send({ status: 'ACCOUNT_CHALLENGE', ...challenge, enrolling: record.enrolling });
      } else if (message.action === 'ACCOUNT_PROOF') {
        if (!record.challenge || !record.challenge.verify(message)) throw new Error();
        if (record.enrolling) {
          const code = String(record.approvalCode).padStart(6, '0');
          send({ status: 'ACCOUNT_APPROVAL_PENDING', code });
          const approved = await this.requestApproval(socket.clientIp, `${record.phone.name} · код ${code}`);
          if (!current() || !approved) throw new Error();
          // Fetch revocations again after the human approval wait.
          await this.refresh();
          if (!current() || !this.online || this.devices.some(d => (d.id === record.phoneId || d.id === this.identity.id) && d.revokedAt)) throw new Error();
          const previous = await this.directory.grants(this.devices);
          if (!current()) throw new Error();
          const minimumRevision = Math.max(0, ...previous.filter(item => item.grant.hostId === this.identity.id &&
            item.grant.phoneId === record.phoneId).map(item => item.grant.revision)) + 1;
          record.grant = await this.trust.approve(record.phone, this.getHost().tlsFingerprint, minimumRevision);
          if (!current()) throw new Error();
          await this.directory.publishGrant(record.grant);
          if (!current()) throw new Error();
        }
        if (!this.trust.isAllowed(record.grant)) throw new Error();
        record.authenticatedGrant = record.grant;
        clearTimeout(record.timeout);
        onAuthenticated(record.grant);
        this.emit('change', this.snapshot());
      } else throw new Error();
    } catch { reject(); }
    finally { record.busy = false; }
    return true;
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.generation++; this.closeAccountSockets(); this.auth.dispose(); }
}

module.exports = { AccountHostService };
