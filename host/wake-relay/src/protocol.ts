export interface WakeRequest {
  version: number;
  type: string;
  groupId: string;
  targetDeviceId: string;
  senderDeviceId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface GroupRegistration {
  version: number;
  type: string;
  groupId: string;
  ownerDeviceId: string;
  ownerPublicKeySpki: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface MembershipCertificate {
  version: number;
  type: string;
  groupId: string;
  deviceId: string;
  role: string;
  publicKeySpki: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface MemberRevocation {
  version: number;
  type: string;
  groupId: string;
  ownerDeviceId: string;
  deviceId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export function canonicalizeWakeRequest(message: WakeRequest): Uint8Array {
  return new TextEncoder().encode([
    'AETHER_WAKE/1',
    `type=${message.type}`,
    `groupId=${message.groupId}`,
    `targetDeviceId=${message.targetDeviceId}`,
    `senderDeviceId=${message.senderDeviceId}`,
    `nonce=${message.nonce}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'));
}

export function canonicalizeGroupRegistration(message: GroupRegistration): Uint8Array {
  return new TextEncoder().encode([
    'AETHER_WAKE_GROUP/1',
    'type=wake.group.register',
    `groupId=${message.groupId}`,
    `ownerDeviceId=${message.ownerDeviceId}`,
    `ownerPublicKeySpki=${message.ownerPublicKeySpki}`,
    `nonce=${message.nonce}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'));
}

export function canonicalizeMembershipCertificate(message: MembershipCertificate): Uint8Array {
  return new TextEncoder().encode([
    'AETHER_WAKE_MEMBER/1',
    'type=wake.membership',
    `groupId=${message.groupId}`,
    `deviceId=${message.deviceId}`,
    `role=${message.role}`,
    `publicKeySpki=${message.publicKeySpki}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'));
}

export function canonicalizeMemberRevocation(message: MemberRevocation): Uint8Array {
  return new TextEncoder().encode([
    'AETHER_WAKE_REVOKE/1',
    'type=wake.member.revoke',
    `groupId=${message.groupId}`,
    `ownerDeviceId=${message.ownerDeviceId}`,
    `deviceId=${message.deviceId}`,
    `nonce=${message.nonce}`,
    `issuedAt=${message.issuedAt}`,
    `expiresAt=${message.expiresAt}`
  ].join('\n'));
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export function derEcdsaSignatureToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error('invalid_der_signature');
  let offset = 2;
  const readInteger = (): Uint8Array => {
    if (der[offset] !== 0x02) throw new Error('invalid_der_signature');
    const length = der[offset + 1];
    offset += 2;
    if (length < 1 || length > 33 || offset + length > der.length) throw new Error('invalid_der_signature');
    let value = der.slice(offset, offset + length);
    offset += length;
    if (value.length === 33) {
      if (value[0] !== 0) throw new Error('invalid_der_signature');
      value = value.slice(1);
    }
    if (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) throw new Error('invalid_der_signature');
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const r = readInteger();
  const s = readInteger();
  if (offset !== der.length) throw new Error('invalid_der_signature');
  return new Uint8Array([...r, ...s]);
}

export async function verifyP256DerSignature(
  publicKeySpkiBase64: string,
  payload: Uint8Array,
  signatureBase64: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      toArrayBuffer(decodeBase64(publicKeySpkiBase64)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      toArrayBuffer(derEcdsaSignatureToRaw(decodeBase64(signatureBase64))),
      toArrayBuffer(payload)
    );
  } catch {
    return false;
  }
}

export async function verifyGroupRegistration(message: GroupRegistration, nowMs: number): Promise<boolean> {
  const identifier = /^[0-9a-f]{32}$/;
  if (message.version !== 1 || message.type !== 'wake.group.register') return false;
  if (![message.groupId, message.ownerDeviceId, message.nonce].every(value => identifier.test(value))) return false;
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)) return false;
  const ttl = message.expiresAt - message.issuedAt;
  if (ttl < 1 || ttl > 30_000 || nowMs > message.expiresAt || message.issuedAt > nowMs + 10_000 || nowMs - message.issuedAt > 40_000) return false;
  if (typeof message.ownerPublicKeySpki !== 'string' || message.ownerPublicKeySpki.length > 2048) return false;
  return verifyP256DerSignature(message.ownerPublicKeySpki, canonicalizeGroupRegistration(message), message.signature);
}

export async function verifyMembershipCertificate(
  message: MembershipCertificate,
  ownerPublicKeySpki: string,
  nowMs: number
): Promise<boolean> {
  const identifier = /^[0-9a-f]{32}$/;
  if (message.version !== 1 || message.type !== 'wake.membership') return false;
  if (!identifier.test(message.groupId) || !identifier.test(message.deviceId)) return false;
  if (!['owner', 'phone', 'bridge', 'host'].includes(message.role)) return false;
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)) return false;
  if (message.expiresAt <= message.issuedAt || nowMs > message.expiresAt) return false;
  if (typeof message.publicKeySpki !== 'string' || message.publicKeySpki.length > 2048) return false;
  return verifyP256DerSignature(ownerPublicKeySpki, canonicalizeMembershipCertificate(message), message.signature);
}

export async function verifyMemberRevocation(message: MemberRevocation, ownerPublicKeySpki: string, nowMs: number): Promise<boolean> {
  const identifier = /^[0-9a-f]{32}$/;
  if (message.version !== 1 || message.type !== 'wake.member.revoke') return false;
  if (![message.groupId, message.ownerDeviceId, message.deviceId, message.nonce].every(value => identifier.test(value))) return false;
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)) return false;
  const ttl = message.expiresAt - message.issuedAt;
  if (ttl < 1 || ttl > 30_000 || nowMs > message.expiresAt || message.issuedAt > nowMs + 10_000 || nowMs - message.issuedAt > 40_000) return false;
  return verifyP256DerSignature(ownerPublicKeySpki, canonicalizeMemberRevocation(message), message.signature);
}

export function validateWakeRequest(message: WakeRequest, nowMs: number): string | null {
  const identifier = /^[0-9a-f]{32}$/;
  if (message.version !== 1 || message.type !== 'wake.request') return 'invalid_version_or_type';
  if (![message.groupId, message.targetDeviceId, message.senderDeviceId, message.nonce].every(value => identifier.test(value))) return 'invalid_identifier';
  if (!Number.isSafeInteger(message.issuedAt) || !Number.isSafeInteger(message.expiresAt)) return 'invalid_time';
  const ttl = message.expiresAt - message.issuedAt;
  if (ttl < 1 || ttl > 30_000) return 'invalid_ttl';
  if (message.issuedAt > nowMs + 10_000) return 'future_issued_at';
  if (nowMs - message.issuedAt > 40_000) return 'stale';
  if (nowMs > message.expiresAt) return 'expired';
  return null;
}

export async function verifyWakeRequest(message: WakeRequest, publicKeySpki: string, nowMs: number): Promise<boolean> {
  if (validateWakeRequest(message, nowMs) !== null) return false;
  return verifyP256DerSignature(publicKeySpki, canonicalizeWakeRequest(message), message.signature);
}
