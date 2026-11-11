import assert from 'node:assert/strict';
import test from 'node:test';
import { getDiagnosticInfo } from './aetherProtocol.ts';

test('TLS fingerprint mismatch has a distinct security diagnostic', () => {
  const tls = getDiagnosticInfo('TLS_MITM_WARNING', 'en');
  const timeout = getDiagnosticInfo('AUTH_TIMEOUT', 'en');

  assert.equal(tls.icon, 'triangle-alert');
  assert.match(tls.title, /TLS Fingerprint Changed/);
  assert.notDeepEqual(tls, timeout);
});
