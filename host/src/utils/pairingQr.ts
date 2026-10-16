export function buildPairingQrUri(host: string, port: number, code9: string, tlsFingerprint?: string): string {
  const normalizedHost = host.trim();
  if (!normalizedHost) throw new Error('Pairing host is required');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Pairing port must be between 1 and 65535');
  }
  if (!/^\d{12}$/.test(code9)) {
    throw new Error('Pairing code must contain exactly twelve digits');
  }
  const query = new URLSearchParams({ pin: code9 });
  if (tlsFingerprint) {
    if (!/^SHA256:[A-F0-9]{64}$/i.test(tlsFingerprint)) throw new Error('Invalid TLS fingerprint');
    query.set('tlsFingerprint', tlsFingerprint.toUpperCase());
  }
  return `aether://${normalizedHost}:${port}?${query.toString()}`;
}
