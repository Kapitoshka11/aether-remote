type SecurityCode = 'rate_limited' | 'invalid_signature';

// Only aggregate counts are logged: no group, device, nonce, key, or request payload.
export class SecurityMetrics {
  private windowStart = 0;
  private counts: Record<SecurityCode, number> = { rate_limited: 0, invalid_signature: 0 };
  constructor(private readonly emit: (event: object) => void = event => console.warn(JSON.stringify(event))) {}

  record(code: SecurityCode, now = Date.now()): void {
    if (now - this.windowStart >= 60_000) {
      this.windowStart = now;
      this.counts = { rate_limited: 0, invalid_signature: 0 };
    }
    const count = ++this.counts[code];
    if (count === 1 || count === 10 || (count > 10 && (count & (count - 1)) === 0)) {
      this.emit({ event: 'wake_security', code, count, windowStart: this.windowStart,
        severity: count >= 10 ? 'alert' : 'notice' });
    }
  }
}
