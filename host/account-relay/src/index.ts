import { DurableObject } from 'cloudflare:workers';
import { UUID, DEVICE_ID, MAX_FRAME, WINDOW, base64url, decode, keyId, verifyJoin, type JoinChallenge } from './protocol';

export interface Env {
  ACCOUNT_TUNNELS: DurableObjectNamespace<AccountTunnel>;
  JOIN_LIMITER: RateLimit;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}
type Admission = {
  ownerId: string; sessionId: string; role: 'host' | 'phone'; deviceId: string;
  publicKeySpki: string; tokenExpiresAt: number; admissionExpiresAt: number;
};
type Attachment = Admission & {
  challenge: JoinChallenge; authorized: boolean; sent: number; acked: number;
};

const deny = (status = 403) => Response.json({ error: 'relay_access_denied' }, { status, headers: { 'Cache-Control': 'no-store' } });

async function supabase(env: Env, path: string, bearer: string): Promise<any> {
  const response = await fetch(env.SUPABASE_URL + path, { headers: {
    apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${bearer}`
  }, signal: AbortSignal.timeout(10000) });
  if (!response.ok || Number(response.headers.get('Content-Length') || 0) > 65536) throw new Error('cloud_unavailable');
  const text = await response.text();
  if (text.length > 65536) throw new Error('cloud_response_too_large');
  return JSON.parse(text);
}

export async function authorize(request: Request, env: Env, sessionId: string, role: 'host' | 'phone'): Promise<Admission> {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/)?.[1];
  if (!bearer || bearer.length > 16384) throw new Error('invalid_auth');
  const user = await supabase(env, '/auth/v1/user', bearer);
  if (!UUID.test(user.id) || !user.email_confirmed_at || user.is_anonymous) throw new Error('invalid_owner');
  if (!(await env.JOIN_LIMITER.limit({ key: `owner:${user.id}` })).success) throw new Error('owner_rate_limit');
  const claims = JSON.parse(new TextDecoder().decode(decode(bearer.split('.')[1])));
  if (!Number.isSafeInteger(claims.exp) || claims.sub !== user.id || claims.exp * 1000 <= Date.now()) throw new Error('expired_auth');
  const sessions = await supabase(env, `/rest/v1/aether_sessions?owner_id=eq.${user.id}&id=eq.${sessionId}&select=*&limit=1`, bearer);
  const session = sessions[0];
  if (!session || session.owner_id !== user.id || session.id !== sessionId || !['pending', 'accepted'].includes(session.state) ||
      !DEVICE_ID.test(session.host_id) || !DEVICE_ID.test(session.phone_id) || session.host_id === session.phone_id ||
      !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) throw new Error('invalid_session');
  const devices = await supabase(env, `/rest/v1/aether_devices?owner_id=eq.${user.id}&id=in.(${session.host_id},${session.phone_id})&select=*&limit=2`, bearer);
  const host = devices.find((d: any) => d.id === session.host_id && d.kind === 'host');
  const phone = devices.find((d: any) => d.id === session.phone_id && d.kind === 'phone');
  if (!host || !phone || devices.length !== 2 || devices.some((d: any) => d.owner_id !== user.id || d.revoked_at !== null)) throw new Error('revoked_device');
  for (const device of devices) if (await keyId(device.public_key_spki) !== device.id) throw new Error('invalid_device_key');
  const device = role === 'host' ? host : phone;
  return { ownerId: user.id, sessionId, role, deviceId: device.id, publicKeySpki: device.public_key_spki,
    tokenExpiresAt: Math.min(claims.exp * 1000, Date.now() + 3600000), admissionExpiresAt: Date.parse(session.expires_at) };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return Response.json({ status: 'ok', protocol: 'aether-account-relay-v1' });
    const match = url.pathname.match(/^\/v1\/connect\/([0-9a-f-]{36})\/(host|phone)$/);
    if (!match || !UUID.test(match[1]) || request.method !== 'GET' || url.search || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return deny(400);
    if (!request.headers.get('Authorization')) return deny(401);
    if (!(await env.JOIN_LIMITER.limit({ key: `preauth:${request.headers.get('CF-Connecting-IP') || 'unknown'}` })).success) return deny(429);
    try {
      const admission = await authorize(request, env, match[1], match[2] as 'host' | 'phone');
      const stub = env.ACCOUNT_TUNNELS.get(env.ACCOUNT_TUNNELS.idFromName(`${admission.ownerId}:${admission.sessionId}`));
      // Construct new headers: callers cannot supply their own admission metadata.
      return await stub.fetch(new Request('https://account-tunnel/join', { headers: {
        Upgrade: 'websocket', 'X-Aether-Admission': JSON.stringify(admission)
      } }));
    } catch { return deny(); }
  }
} satisfies ExportedHandler<Env>;

export class AccountTunnel extends DurableObject<Env> {
  private closed = false;
  private started = false;
  private joins = 0;
  private until = 0;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const state = await ctx.storage.get<{ closed: boolean; started: boolean; joins: number; until: number }>('state');
      if (state) Object.assign(this, state);
    });
  }
  private sockets(): WebSocket[] { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1); }
  private save() { return this.ctx.storage.put('state', { closed: this.closed, started: this.started, joins: this.joins, until: this.until }); }
  async fetch(request: Request): Promise<Response> {
    if (this.closed || this.started || this.joins >= 6) return deny();
    let admission: Admission;
    try { admission = JSON.parse(request.headers.get('X-Aether-Admission') || ''); } catch { return deny(); }
    if (!UUID.test(admission.ownerId) || !UUID.test(admission.sessionId) || !DEVICE_ID.test(admission.deviceId) ||
        !['host', 'phone'].includes(admission.role) || !Number.isFinite(admission.tokenExpiresAt) ||
        !Number.isFinite(admission.admissionExpiresAt) || admission.admissionExpiresAt <= Date.now() || admission.tokenExpiresAt <= Date.now()) return deny();
    const sockets = this.sockets();
    if (sockets.length >= 2 || sockets.some(ws => {
      const a = ws.deserializeAttachment() as Attachment;
      return a.role === admission.role || a.ownerId !== admission.ownerId || a.sessionId !== admission.sessionId;
    })) return deny();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const challenge: JoinChallenge = { ownerId: admission.ownerId, sessionId: admission.sessionId,
      role: admission.role, deviceId: admission.deviceId,
      nonce: base64url(crypto.getRandomValues(new Uint8Array(32))), expiresAt: Math.min(Date.now() + 15000, admission.admissionExpiresAt) };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...admission, challenge, authorized: false, sent: 0, acked: 0 } satisfies Attachment);
    this.joins++;
    this.until = this.until ? Math.min(this.until, challenge.expiresAt) : challenge.expiresAt;
    await this.save();
    await this.ctx.storage.setAlarm(this.until);
    server.send(JSON.stringify({ type: 'challenge', ...challenge }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    try {
      if (this.closed || Date.now() >= this.until) throw new Error('expired_tunnel');
      const attachment = socket.deserializeAttachment() as Attachment;
      if (!attachment.authorized) {
        if (typeof message !== 'string' || message.length > 2048 || Date.now() >= attachment.challenge.expiresAt) throw new Error('invalid_join_proof');
        const proof = JSON.parse(message);
        if (proof.type !== 'proof' || !await verifyJoin(attachment.challenge, proof.signature, attachment.publicKeySpki)) throw new Error('invalid_join_proof');
        // Recheck after asynchronous crypto to exclude timeout/parallel duplicate proofs.
        if (this.closed || Date.now() >= this.until || (socket.deserializeAttachment() as Attachment).authorized) throw new Error('duplicate_join_proof');
        attachment.authorized = true;
        socket.serializeAttachment(attachment);
        const sockets = this.sockets();
        if (sockets.length === 2 && sockets.every(ws => (ws.deserializeAttachment() as Attachment).authorized)) {
          this.started = true;
          this.until = Math.min(...sockets.map(ws => (ws.deserializeAttachment() as Attachment).tokenExpiresAt));
          await this.save();
          await this.ctx.storage.setAlarm(this.until);
          for (const ws of sockets) ws.send(JSON.stringify({ type: 'ready', expiresAt: this.until }));
        }
        return;
      }
      if (!this.started || typeof message === 'string' || message.byteLength < 5 || message.byteLength > MAX_FRAME) throw new Error('invalid_carrier');
      const other = this.sockets().find(ws => ws !== socket);
      if (!other) throw new Error('peer_closed');
      const peer = other.deserializeAttachment() as Attachment;
      const view = new DataView(message), count = view.getUint32(1);
      if (view.getUint8(0) === 0) {
        const size = message.byteLength - 5;
        if (size === 0 || count !== attachment.sent || count + size > 0xffffffff || attachment.sent - attachment.acked + size > WINDOW) throw new Error('credit_exceeded');
        attachment.sent += size;
        socket.serializeAttachment(attachment);
      } else if (view.getUint8(0) === 1) {
        if (message.byteLength !== 5 || count < peer.acked || count > peer.sent) throw new Error('invalid_ack');
        peer.acked = count;
        other.serializeAttachment(peer);
      } else throw new Error('invalid_frame_type');
      other.send(message);
    } catch { await this.closeTunnel(); }
  }
  private async closeTunnel() {
    if (this.closed) return;
    this.closed = true;
    for (const socket of this.sockets()) socket.close(1008, 'Tunnel closed');
    await this.save();
    await this.ctx.storage.setAlarm(Date.now() + 120000);
  }
  async webSocketClose() { await this.closeTunnel(); }
  async webSocketError() { await this.closeTunnel(); }
  async alarm() {
    if (this.closed) { await this.ctx.storage.deleteAll(); return; }
    await this.closeTunnel();
  }
}
