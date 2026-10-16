import { expect, it } from 'vitest';
import { SecurityMetrics } from '../src/security-metrics';

it('aggregates attack alerts without sensitive identifiers and resets each minute', () => {
  const events: object[] = [];
  const metrics = new SecurityMetrics(event => events.push(event));
  for (let i = 0; i < 12; i++) metrics.record('invalid_signature', 100_000);
  expect(events).toEqual([
    { event: 'wake_security', code: 'invalid_signature', count: 1, windowStart: 100_000, severity: 'notice' },
    { event: 'wake_security', code: 'invalid_signature', count: 10, windowStart: 100_000, severity: 'alert' }
  ]);
  metrics.record('rate_limited', 100_000);
  metrics.record('invalid_signature', 160_000);
  expect(events.at(-1)).toMatchObject({ count: 1, windowStart: 160_000 });
});
