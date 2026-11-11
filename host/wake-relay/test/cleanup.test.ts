import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('wake relay cleanup', () => {
  it('removes expired replay, request, rate and pending-target records', async () => {
    const namespace = (env as unknown as { HOME_GROUPS: DurableObjectNamespace }).HOME_GROUPS;
    const stub = namespace.get(namespace.idFromName(crypto.randomUUID()));
    const now = Date.now();
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.put('nonce:old', now - 1);
      await state.storage.put('request:old', { expiresAt: now - 1 });
      await state.storage.put('revocation-nonce:old', now - 1);
      await state.storage.put('rate:phone', { windowStart: now - 60_001, count: 10 });
      await state.storage.put('pending-target:target', [
        { nonce: 'old', expiresAt: now - 1 },
        { nonce: 'active', expiresAt: now + 60_000 }
      ]);
      await state.storage.setAlarm(now + 1_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const result = await runInDurableObject(stub, async (_instance, state) => ({
      nonce: await state.storage.get('nonce:old'),
      request: await state.storage.get('request:old'),
      revocation: await state.storage.get('revocation-nonce:old'),
      rate: await state.storage.get('rate:phone'),
      pending: await state.storage.get<Array<{ nonce: string }>>('pending-target:target')
    }));
    expect(result).toEqual({ nonce: undefined, request: undefined, revocation: undefined, rate: undefined, pending: [{ nonce: 'active', expiresAt: now + 60_000 }] });
  });
});
