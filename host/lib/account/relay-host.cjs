const { connectRelay } = require('./relay-client.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class AccountRelayHost {
  constructor({ client, directory, ownerId, identity, url, acceptStream, connect = connectRelay }) {
    Object.assign(this, { client, directory, ownerId, identity, url, acceptStream, connect });
    this.entries = new Map();
    this.seen = new Map();
    this.stopped = false;
    this.channel = client.channel(`aether-sessions:${identity.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'aether_sessions',
        filter: `owner_id=eq.${ownerId}` }, () => { void this.reconcile(); })
      .subscribe(status => { if (status === 'SUBSCRIBED') void this.reconcile(); });
    // Realtime is the fast path. This bounded poll recovers missed notifications
    // before the phone's relay join timeout expires.
    this.timer = setInterval(() => { void this.reconcile(); }, 10000);
    this.timer.unref();
    void this.reconcile();
  }
  async reconcile() {
    if (this.stopped || this.reconciling) return;
    this.reconciling = true;
    try {
      const rows = await this.directory.sessions(this.identity.id);
      if (this.stopped) return;
      for (const [id, expiry] of this.seen) if (expiry <= Date.now()) this.seen.delete(id);
      for (const row of rows) {
        const expiry = Date.parse(row.expires_at);
        if (!UUID.test(row.id) || row.owner_id !== this.ownerId || row.host_id !== this.identity.id ||
            !/^[0-9a-f]{64}$/.test(row.phone_id) || row.state !== 'pending' ||
            !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 120000 ||
            this.entries.size >= 8 || this.seen.has(row.id)) continue;
        this.seen.set(row.id, expiry);
        const entry = { phoneId: row.phone_id, abort: new AbortController(), stream: null };
        this.entries.set(row.id, entry);
        void this.join(row.id, entry);
      }
    } catch { /* A reconnect notification or bounded poll retries directory availability. */ }
    finally { this.reconciling = false; }
  }
  async join(sessionId, entry) {
    const current = () => !this.stopped && this.entries.get(sessionId) === entry;
    try {
      const result = await this.client.auth.getSession();
      const session = result.data?.session;
      if (!current() || result.error || session?.user?.id !== this.ownerId || !session.access_token) throw new Error();
      const stream = await this.connect({ url: this.url, ownerId: this.ownerId, sessionId,
        identity: this.identity, accessToken: session.access_token, signal: entry.abort.signal });
      stream.on('error', () => {});
      if (!current()) { stream.destroy(); return; }
      entry.stream = stream;
      stream.once('close', () => { if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId); });
      this.acceptStream(stream, sessionId);
    } catch {
      entry.abort.abort();
      entry.stream?.destroy();
      if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId);
    }
  }
  matches(sessionId, phoneId) {
    const entry = this.entries.get(sessionId);
    return !this.stopped && !!entry?.stream && !entry.stream.destroyed && (!phoneId || entry.phoneId === phoneId);
  }
  revoke(deviceId) {
    for (const [id, entry] of this.entries) if (deviceId === this.identity.id || entry.phoneId === deviceId) {
      this.entries.delete(id);
      entry.abort.abort();
      entry.stream?.destroy();
    }
  }
  dispose() {
    this.stopped = true;
    clearInterval(this.timer);
    void this.client.removeChannel(this.channel).catch(() => {});
    this.revoke(this.identity.id);
    this.seen.clear();
  }
}

module.exports = { AccountRelayHost };
