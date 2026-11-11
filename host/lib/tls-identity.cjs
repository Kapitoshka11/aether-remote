const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const selfsigned = require('selfsigned');

const CERT_FILE = 'host-cert.pem';
const KEY_FILE = 'host-key.pem';
const MIN_REMAINING_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

function certificateFingerprint(certPem) {
  const certificate = new crypto.X509Certificate(certPem);
  return `SHA256:${certificate.fingerprint256.replaceAll(':', '').toUpperCase()}`;
}

function readValidIdentity(directory, now = Date.now()) {
  const certPath = path.join(directory, CERT_FILE);
  const keyPath = path.join(directory, KEY_FILE);
  const cert = fs.readFileSync(certPath, 'utf8');
  const key = fs.readFileSync(keyPath, 'utf8');
  const certificate = new crypto.X509Certificate(cert);
  const expiresAt = Date.parse(certificate.validTo);
  if (!Number.isFinite(expiresAt) || expiresAt - now < MIN_REMAINING_VALIDITY_MS) {
    throw new Error('TLS identity is expired or near expiry');
  }
  crypto.createPrivateKey(key);
  return { cert, key, fingerprint: certificateFingerprint(cert), certPath, keyPath };
}

function atomicWrite(filePath, contents) {
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

async function loadOrCreateTlsIdentity(directory, ipAddresses = []) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    return readValidIdentity(directory);
  } catch (_) {
    const notBeforeDate = new Date(Date.now() - 5 * 60 * 1000);
    const notAfterDate = new Date(notBeforeDate);
    notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
    const altNames = [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      ...ipAddresses.filter(value => /^\d{1,3}(\.\d{1,3}){3}$/.test(value)).map(ip => ({ type: 7, ip }))
    ];
    const generated = await selfsigned.generate(
      [{ name: 'commonName', value: 'Aether Remote Host' }],
      {
        keyType: 'ec',
        curve: 'P-256',
        algorithm: 'sha256',
        notBeforeDate,
        notAfterDate,
        extensions: [
          { name: 'basicConstraints', cA: false, critical: true },
          { name: 'keyUsage', digitalSignature: true, keyAgreement: true, critical: true },
          { name: 'extKeyUsage', serverAuth: true },
          { name: 'subjectAltName', altNames }
        ]
      }
    );
    atomicWrite(path.join(directory, CERT_FILE), generated.cert);
    atomicWrite(path.join(directory, KEY_FILE), generated.private);
    return readValidIdentity(directory);
  }
}

module.exports = { certificateFingerprint, loadOrCreateTlsIdentity, readValidIdentity };
