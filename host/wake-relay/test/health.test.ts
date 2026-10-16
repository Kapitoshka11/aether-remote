import { describe, expect, it } from 'vitest';
import worker from '../src/index';

describe('wake relay health', () => {
  it('reports protocol version one without touching group state', async () => {
    const response = await worker.fetch(new Request('https://relay.test/health'), {} as never, {} as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok', protocolVersion: 1 });
  });

  it('rejects unknown routes', async () => {
    const response = await worker.fetch(new Request('https://relay.test/unknown'), {} as never, {} as never);

    expect(response.status).toBe(404);
  });
});
