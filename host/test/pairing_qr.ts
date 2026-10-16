import assert from 'node:assert/strict';
import { buildPairingQrUri } from '../src/utils/pairingQr.ts';

assert.equal(
  buildPairingQrUri('192.168.1.42', 8080, '123456789012'),
  'aether://192.168.1.42:8080?pin=123456789012',
);
assert.equal(
  buildPairingQrUri('192.168.1.42', 8080, '123456789012', `SHA256:${'AB'.repeat(32)}`),
  `aether://192.168.1.42:8080?pin=123456789012&tlsFingerprint=SHA256%3A${'AB'.repeat(32)}`,
);

assert.throws(() => buildPairingQrUri('', 8080, '123456789012'));
assert.throws(() => buildPairingQrUri('192.168.1.42', 0, '123456789012'));
assert.throws(() => buildPairingQrUri('192.168.1.42', 8080, '123'));
assert.throws(() => buildPairingQrUri('192.168.1.42', 8080, '123456789012', 'bad'));

console.log('Pairing QR contract tests passed.');
