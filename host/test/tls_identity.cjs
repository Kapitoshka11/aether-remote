const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { certificateFingerprint, loadOrCreateTlsIdentity } = require('../lib/tls-identity.cjs');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-tls-test-'));
  try {
    const created = await loadOrCreateTlsIdentity(directory, ['192.168.1.42']);
    assert.match(created.cert, /BEGIN CERTIFICATE/);
    assert.match(created.key, /BEGIN PRIVATE KEY/);
    assert.match(created.fingerprint, /^SHA256:[A-F0-9]{64}$/);
    assert.equal(certificateFingerprint(created.cert), created.fingerprint);

    const reloaded = await loadOrCreateTlsIdentity(directory, ['10.0.0.5']);
    assert.equal(reloaded.cert, created.cert, 'host identity must remain stable when the LAN address changes');
    assert.equal(reloaded.fingerprint, created.fingerprint);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
