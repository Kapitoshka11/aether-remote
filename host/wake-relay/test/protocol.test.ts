import { describe, expect, it } from 'vitest';
import { canonicalizeWakeRequest, verifyP256DerSignature } from '../src/protocol';

function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const integer = (part: Uint8Array): Uint8Array => {
    let offset = 0;
    while (offset < part.length - 1 && part[offset] === 0) offset += 1;
    const value = part.slice(offset);
    const prefixed = (value[0] & 0x80) !== 0 ? new Uint8Array([0, ...value]) : value;
    return new Uint8Array([0x02, prefixed.length, ...prefixed]);
  };
  const r = integer(raw.slice(0, 32));
  const s = integer(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

describe('wake relay protocol', () => {
  it('uses the same canonical request bytes as Node and Android', () => {
    const bytes = canonicalizeWakeRequest({
      version: 1,
      type: 'wake.request',
      groupId: '00112233445566778899aabbccddeeff',
      targetDeviceId: '11112222333344445555666677778888',
      senderDeviceId: '9999aaaabbbbccccddddeeeeffff0000',
      nonce: '0123456789abcdeffedcba9876543210',
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_030_000,
      signature: ''
    });

    expect(new TextDecoder().decode(bytes)).toBe([
      'AETHER_WAKE/1',
      'type=wake.request',
      'groupId=00112233445566778899aabbccddeeff',
      'targetDeviceId=11112222333344445555666677778888',
      'senderDeviceId=9999aaaabbbbccccddddeeeeffff0000',
      'nonce=0123456789abcdeffedcba9876543210',
      'issuedAt=1700000000000',
      'expiresAt=1700000030000'
    ].join('\n'));
  });

  it('verifies the DER signature emitted by Node and Android', async () => {
    const pair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const payload = new TextEncoder().encode('Aether Wake cross-runtime signature');
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, payload));
    const der = rawSignatureToDer(raw);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
    const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

    await expect(verifyP256DerSignature(toBase64(spki), payload, toBase64(der))).resolves.toBe(true);
    await expect(verifyP256DerSignature(toBase64(spki), new TextEncoder().encode('altered'), toBase64(der))).resolves.toBe(false);
  });
});
