import { SecurityMetrics } from './security-metrics';
import {
  GroupRegistration,
  MemberRevocation,
  MembershipCertificate,
  WakeRequest,
  verifyGroupRegistration,
  verifyMembershipCertificate,
  verifyMemberRevocation,
  verifyWakeRequest,
  validateWakeRequest
} from './protocol';

interface StoredOwner {
  groupId: string;
  deviceId: string;
  publicKeySpki: string;
}

interface StoredMember {
  deviceId: string;
  role: string;
  publicKeySpki: string;
  expiresAt: number;
}

interface SocketAttachment {
  groupId: string;
  deviceId: string;
  role: string;
}

interface PendingRequest {
  nonce: string;
  senderDeviceId: string;
  targetDeviceId: string;
  expiresAt: number;
}

const PRESENCE_WAIT_MS = 120_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const PRESENCE_RATE_LIMIT_MAX_MESSAGES = 60;

export class HomeGroup {
  private readonly securityMetrics = new SecurityMetrics();
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown
  ) {}

  private async scheduleCleanup(at: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    if (current === null || at < current) await this.state.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const deleteKeys: string[] = [];
    let nextExpiry: number | null = null;
    const consider = (expiresAt: number) => {
      if (expiresAt > now && (nextExpiry === null || expiresAt < nextExpiry)) nextExpiry = expiresAt;
    };
    for (const prefix of ['nonce:', 'revocation-nonce:']) {
      for (const [key, value] of await this.state.storage.list<number>({ prefix })) {
        if (value <= now) deleteKeys.push(key); else consider(value);
      }
    }
    for (const [key, value] of await this.state.storage.list<PendingRequest>({ prefix: 'request:' })) {
      if (value.expiresAt <= now) deleteKeys.push(key); else consider(value.expiresAt);
    }
    for (const prefix of ['rate:', 'presence-rate:']) {
      for (const [key, value] of await this.state.storage.list<{ windowStart: number }>({ prefix })) {
        const expiresAt = value.windowStart + RATE_LIMIT_WINDOW_MS;
        if (expiresAt <= now) deleteKeys.push(key); else consider(expiresAt);
      }
    }
    for (const [key, value] of await this.state.storage.list<PendingRequest[]>({ prefix: 'pending-target:' })) {
      const active = value.filter(item => item.expiresAt > now);
      if (active.length === 0) deleteKeys.push(key);
      else {
        if (active.length !== value.length) await this.state.storage.put(key, active);
        active.forEach(item => consider(item.expiresAt));
      }
    }
    if (deleteKeys.length > 0) await this.state.storage.delete(deleteKeys);
    if (nextExpiry !== null) await this.state.storage.setAlarm(nextExpiry);
  }

  async fetch(request: Request): Promise<Response> {
    void this.env;
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/socket') return this.openSocket(request);
    if (request.method === 'POST' && url.pathname === '/members') return this.enrollMember(request);
    if (request.method === 'POST' && url.pathname === '/revoke') return this.revokeMember(request);
    if (request.method !== 'POST' || url.pathname !== '/register') return Response.json({ error: 'not_found' }, { status: 404 });
    let registration: GroupRegistration;
    try {
      registration = await request.json<GroupRegistration>();
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (!await verifyGroupRegistration(registration, Date.now())) {
      return Response.json({ error: 'invalid_owner_proof' }, { status: 401 });
    }
    const existing = await this.state.storage.get<StoredOwner>('owner');
    if (existing) {
      const matches = existing.deviceId === registration.ownerDeviceId
        && existing.groupId === registration.groupId
        && existing.publicKeySpki === registration.ownerPublicKeySpki;
      return matches
        ? Response.json({ status: 'ok', created: false })
        : Response.json({ error: 'owner_conflict' }, { status: 409 });
    }
    await this.state.storage.put<StoredOwner>('owner', {
      groupId: registration.groupId,
      deviceId: registration.ownerDeviceId,
      publicKeySpki: registration.ownerPublicKeySpki
    });
    return Response.json({ status: 'ok', created: true }, { status: 201 });
  }

  private async enrollMember(request: Request): Promise<Response> {
    const owner = await this.state.storage.get<StoredOwner>('owner');
    if (!owner) return Response.json({ error: 'group_not_registered' }, { status: 404 });
    let certificate: MembershipCertificate;
    try {
      certificate = await request.json<MembershipCertificate>();
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (certificate.groupId !== owner.groupId || !await verifyMembershipCertificate(certificate, owner.publicKeySpki, Date.now())) {
      return Response.json({ error: 'invalid_membership' }, { status: 401 });
    }
    const key = `member:${certificate.deviceId}`;
    if (await this.state.storage.get(`revoked:${certificate.deviceId}`)) {
      return Response.json({ error: 'member_revoked' }, { status: 401 });
    }
    const existing = await this.state.storage.get<StoredMember>(key);
    if (existing) {
      const matches = existing.role === certificate.role
        && existing.publicKeySpki === certificate.publicKeySpki
        && existing.expiresAt === certificate.expiresAt;
      return matches
        ? Response.json({ status: 'ok', created: false })
        : Response.json({ error: 'member_conflict' }, { status: 409 });
    }
    await this.state.storage.put<StoredMember>(key, {
      deviceId: certificate.deviceId,
      role: certificate.role,
      publicKeySpki: certificate.publicKeySpki,
      expiresAt: certificate.expiresAt
    });
    return Response.json({ status: 'ok', created: true }, { status: 201 });
  }

  private async openSocket(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ error: 'upgrade_required' }, { status: 426 });
    }
    const url = new URL(request.url);
    const deviceId = url.searchParams.get('deviceId') || '';
    const encodedCertificate = url.searchParams.get('certificate') || '';
    let certificate: MembershipCertificate;
    try {
      const normalized = encodedCertificate.replaceAll('-', '+').replaceAll('_', '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      certificate = JSON.parse(atob(padded)) as MembershipCertificate;
    } catch {
      return Response.json({ error: 'invalid_certificate' }, { status: 401 });
    }
    const owner = await this.state.storage.get<StoredOwner>('owner');
    const member = await this.state.storage.get<StoredMember>(`member:${deviceId}`);
    const revoked = await this.state.storage.get(`revoked:${deviceId}`);
    if (!owner || !member || revoked || certificate.deviceId !== deviceId || certificate.groupId !== owner.groupId) {
      return Response.json({ error: 'unknown_member' }, { status: 401 });
    }
    const matches = member.role === certificate.role
      && member.publicKeySpki === certificate.publicKeySpki
      && member.expiresAt === certificate.expiresAt;
    if (!matches || !await verifyMembershipCertificate(certificate, owner.publicKeySpki, Date.now())) {
      return Response.json({ error: 'invalid_certificate' }, { status: 401 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: SocketAttachment = { groupId: certificate.groupId, deviceId, role: member.role };
    server.serializeAttachment(attachment);
    this.state.acceptWebSocket(server, [`device:${deviceId}`, `role:${member.role}`]);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async revokeMember(request: Request): Promise<Response> {
    const owner = await this.state.storage.get<StoredOwner>('owner');
    if (!owner) return Response.json({ error: 'group_not_registered' }, { status: 404 });
    let revocation: MemberRevocation;
    try {
      revocation = await request.json<MemberRevocation>();
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (revocation.groupId !== owner.groupId || revocation.ownerDeviceId !== owner.deviceId
      || !await verifyMemberRevocation(revocation, owner.publicKeySpki, Date.now())) {
      return Response.json({ error: 'invalid_revocation' }, { status: 401 });
    }
    if (await this.state.storage.get(`revocation-nonce:${revocation.nonce}`)) {
      return Response.json({ error: 'replay' }, { status: 409 });
    }
    await this.state.storage.put(`revocation-nonce:${revocation.nonce}`, revocation.expiresAt);
    await this.scheduleCleanup(revocation.expiresAt);
    await this.state.storage.put(`revoked:${revocation.deviceId}`, { revokedAt: Date.now() });
    await this.state.storage.delete(`member:${revocation.deviceId}`);
    for (const socket of this.state.getWebSockets(`device:${revocation.deviceId}`)) {
      socket.close(4003, 'device_revoked');
    }
    return Response.json({ status: 'ok', revoked: true });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    if (typeof rawMessage !== 'string' || rawMessage.length > 16_384) {
      socket.send(JSON.stringify({ type: 'error', code: 'invalid_message' }));
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawMessage) as Record<string, unknown>;
    } catch {
      socket.send(JSON.stringify({ type: 'error', code: 'invalid_json' }));
      return;
    }
    const attachment = socket.deserializeAttachment() as SocketAttachment;
    if (parsed.type === 'wake.delivery') {
      await this.handleDelivery(socket, attachment, parsed, rawMessage);
      return;
    }
    if (parsed.type === 'host.online') {
      await this.handleHostOnline(socket, attachment, parsed, rawMessage);
      return;
    }
    if (parsed.type !== 'wake.request' || attachment.role !== 'phone') {
      socket.send(JSON.stringify({ type: 'error', code: 'unsupported_message' }));
      return;
    }
    const message = parsed as unknown as WakeRequest;
    const validation = validateWakeRequest(message, Date.now());
    if (validation) {
      socket.send(JSON.stringify({ type: 'error', code: validation, nonce: message.nonce }));
      return;
    }
    if (message.groupId !== attachment.groupId || message.senderDeviceId !== attachment.deviceId) {
      socket.send(JSON.stringify({ type: 'error', code: 'sender_mismatch', nonce: message.nonce }));
      return;
    }
    const member = await this.state.storage.get<StoredMember>(`member:${attachment.deviceId}`);
    if (!member || !await verifyWakeRequest(message, member.publicKeySpki, Date.now())) {
      this.securityMetrics.record('invalid_signature');
      socket.send(JSON.stringify({ type: 'error', code: 'invalid_signature', nonce: message.nonce }));
      return;
    }
    if (await this.state.storage.get(`nonce:${message.nonce}`)) {
      socket.send(JSON.stringify({ type: 'error', code: 'replay', nonce: message.nonce }));
      return;
    }
    const rateKey = `rate:${attachment.deviceId}`;
    const currentTime = Date.now();
    const rate = await this.state.storage.get<{ windowStart: number; count: number }>(rateKey);
    const activeRate = rate && currentTime - rate.windowStart < RATE_LIMIT_WINDOW_MS
      ? rate
      : { windowStart: currentTime, count: 0 };
    if (activeRate.count >= RATE_LIMIT_MAX_REQUESTS) {
      this.securityMetrics.record('rate_limited');
      socket.send(JSON.stringify({ type: 'error', code: 'rate_limited', nonce: message.nonce }));
      return;
    }
    await this.state.storage.put(rateKey, { ...activeRate, count: activeRate.count + 1 });
    await this.scheduleCleanup(activeRate.windowStart + RATE_LIMIT_WINDOW_MS);
    const bridges = this.state.getWebSockets('role:bridge').filter(candidate => candidate.readyState === WebSocket.OPEN);
    if (bridges.length === 0) {
      socket.send(JSON.stringify({ type: 'error', code: 'no_bridge', nonce: message.nonce }));
      return;
    }
    await this.state.storage.put(`nonce:${message.nonce}`, message.expiresAt);
    await this.scheduleCleanup(message.expiresAt);
    const pending: PendingRequest = {
      nonce: message.nonce,
      senderDeviceId: attachment.deviceId,
      targetDeviceId: message.targetDeviceId,
      expiresAt: Date.now() + PRESENCE_WAIT_MS
    };
    await this.state.storage.put(`request:${message.nonce}`, pending);
    await this.scheduleCleanup(pending.expiresAt);
    const targetKey = `pending-target:${message.targetDeviceId}`;
    const targetPending = await this.state.storage.get<PendingRequest[]>(targetKey) || [];
    await this.state.storage.put(targetKey, [...targetPending.filter(item => item.expiresAt >= Date.now()), pending].slice(-32));
    for (const bridge of bridges) bridge.send(rawMessage);
  }

  private async handleDelivery(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: Record<string, unknown>,
    rawMessage: string
  ): Promise<void> {
    if (attachment.role !== 'bridge' || typeof message.nonce !== 'string' || typeof message.targetDeviceId !== 'string') {
      socket.send(JSON.stringify({ type: 'error', code: 'invalid_delivery' }));
      return;
    }
    const pending = await this.state.storage.get<PendingRequest>(`request:${message.nonce}`);
    if (!pending || pending.targetDeviceId !== message.targetDeviceId || pending.expiresAt < Date.now()) {
      socket.send(JSON.stringify({ type: 'error', code: 'unknown_request', nonce: message.nonce }));
      return;
    }
    for (const phone of this.state.getWebSockets(`device:${pending.senderDeviceId}`)) {
      if (phone.readyState === WebSocket.OPEN) phone.send(rawMessage);
    }
  }

  private async handleHostOnline(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: Record<string, unknown>,
    rawMessage: string
  ): Promise<void> {
    const presenceAllowed = attachment.role === 'host'
      ? message.deviceId === attachment.deviceId
      : attachment.role === 'bridge' && typeof message.deviceId === 'string' && /^[0-9a-f]{32}$/.test(message.deviceId);
    if (!presenceAllowed || !Number.isSafeInteger(message.onlineAt)) {
      socket.send(JSON.stringify({ type: 'error', code: 'invalid_presence' }));
      return;
    }
    const presenceDeviceId = String(message.deviceId);
    const rateKey = `presence-rate:${attachment.deviceId}`;
    const currentTime = Date.now();
    const rate = await this.state.storage.get<{ windowStart: number; count: number }>(rateKey);
    const activeRate = rate && currentTime - rate.windowStart < RATE_LIMIT_WINDOW_MS
      ? rate
      : { windowStart: currentTime, count: 0 };
    if (activeRate.count >= PRESENCE_RATE_LIMIT_MAX_MESSAGES) {
      this.securityMetrics.record('rate_limited');
      socket.send(JSON.stringify({ type: 'error', code: 'rate_limited' }));
      return;
    }
    await this.state.storage.put(rateKey, { ...activeRate, count: activeRate.count + 1 });
    await this.scheduleCleanup(activeRate.windowStart + RATE_LIMIT_WINDOW_MS);
    const targetKey = `pending-target:${presenceDeviceId}`;
    const pending = await this.state.storage.get<PendingRequest[]>(targetKey) || [];
    const active = pending.filter(item => item.expiresAt >= Date.now());
    for (const request of active) {
      for (const phone of this.state.getWebSockets(`device:${request.senderDeviceId}`)) {
        if (phone.readyState === WebSocket.OPEN) phone.send(rawMessage);
      }
    }
    await this.state.storage.delete([...pending.map(request => `request:${request.nonce}`), targetKey]);
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}
