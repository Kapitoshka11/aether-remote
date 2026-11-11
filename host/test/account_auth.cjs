const assert = require('node:assert/strict');
const { AccountAuth } = require('../lib/account/auth-client.cjs');
const { createSecureStore } = require('../lib/account/secure-store.cjs');
const { createOAuthCallback } = require('../lib/account/oauth-loopback.cjs');

(async () => {
  let listener, release;
  const client = { auth: {
    onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
    async signInWithPassword(input) {
      if (input.email === 'error@example.test') return { error: { code: 'invalid_credentials', message: 'secret-server-payload' } };
      await new Promise(resolve => { release = resolve; });
      listener('SIGNED_IN', { access_token: 'secret-access-token', refresh_token: 'secret-refresh-token', user: {
        id: 'test-id', email: input.email, email_confirmed_at: '2026-09-07T00:00:00Z' } });
      return { error: null };
    },
    async signOut() { listener('SIGNED_OUT', null); return { error: null }; },
    stopAutoRefresh() {}
  }, removeAllChannels() {} };
  const adapters = [];
  const auth = new AccountAuth({ storage: await createSecureStore({}), clientFactory: (_url, _key, options) => {
    adapters.push(options.auth.storage); return client;
  } });
  assert.equal((await auth.signIn('invalid', 'x')).ok, false);
  const failure = await auth.signIn('error@example.test', 'password123');
  assert.equal(failure.message, 'Неверная почта или пароль.');
  assert.equal(JSON.stringify(failure).includes('secret'), false);
  const pending = auth.signIn('person@example.test', 'password123');
  assert.equal((await auth.signIn('another@example.test', 'password123')).ok, false);
  release();
  assert.equal((await pending).ok, true);
  assert.equal(auth.snapshot().profile.email, 'person@example.test');
  assert.equal(JSON.stringify(auth.snapshot()).includes('secret'), false);
  assert.equal((await auth.signOut()).ok, true);
  assert.equal(auth.snapshot().profile, null);
  auth.profile = { id: 'test-id', email: 'offline@example.test', confirmed: true };
  await auth.storage.setItem('aether-supabase-auth-v1', JSON.stringify({ access_token: 'expired-test-token' }));
  client.auth.signOut = async () => ({ error: { code: 'request_timeout' } });
  assert.equal((await auth.signOut()).ok, true, 'an unavailable refresh endpoint must not prevent local logout');
  assert.equal(auth.snapshot().profile, null);
  assert.equal(await auth.storage.getItem('aether-supabase-auth-v1'), null);
  await adapters[0].setItem('aether-supabase-auth-v1', 'stale-refresh-result');
  assert.equal(await auth.storage.getItem('aether-supabase-auth-v1'), null, 'an old SDK refresh cannot restore the signed-out session');
  let emailRedirect;
  client.auth.signUp = async input => {
    assert.equal(input.email, 'person@example.test');
    emailRedirect = input.options.emailRedirectTo;
    return { data: {}, error: null };
  };
  client.auth.resetPasswordForEmail = async (email, options) => {
    assert.equal(email, 'person@example.test');
    emailRedirect = options.redirectTo;
    return { data: {}, error: null };
  };
  client.auth.exchangeCodeForSession = async code => {
    assert.equal(code, 'email-test-code');
    return { error: null };
  };
  client.auth.updateUser = async input => {
    assert.equal(input.password, 'new-password123');
    return { error: null };
  };
  const waitForEmail = () => new Promise(resolve => {
    const changed = state => {
      if (state.message && auth.callback) { auth.off('change', changed); resolve(); }
    };
    auth.on('change', changed);
  });
  for (const recovery of [false, true]) {
    const ready = waitForEmail();
    const operation = recovery ? auth.recover('person@example.test') : auth.signUp('person@example.test', 'password123');
    await ready;
    assert.equal(new URL(emailRedirect).hostname, '127.0.0.1');
    assert.equal((await fetch(emailRedirect + '?code=email-test-code')).status, 200);
    assert.equal((await operation).ok, true);
    assert.equal(auth.snapshot().passwordRecovery, recovery);
    assert.equal(auth.callback, null);
  }
  assert.equal((await auth.updatePassword('new-password123')).ok, true);
  assert.equal(auth.snapshot().passwordRecovery, false);
  const cancelReady = waitForEmail();
  const cancelOperation = auth.recover('person@example.test');
  await cancelReady;
  auth.cancelSignIn();
  assert.equal((await cancelOperation).ok, false);
  assert.equal(auth.callback, null);
  assert.equal(auth.snapshot().busy, false);
  auth.dispose();

  const callback = await createOAuthCallback({ timeoutMs: 5000 });
  assert.equal(new URL(callback.redirectTo).hostname, '127.0.0.1');
  const wrong = new URL(callback.redirectTo); wrong.pathname = '/wrong';
  assert.equal((await fetch(wrong)).status, 404);
  const success = await fetch(callback.redirectTo + '?code=test-code&sb_flow_id=test-flow');
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await callback.result, { code: 'test-code', flowId: 'test-flow' });
  callback.cancel();
  const cancelled = await createOAuthCallback();
  cancelled.cancel();
  await assert.rejects(cancelled.result, /account_oauth_cancelled/);
  const expired = await createOAuthCallback({ timeoutMs: 30 });
  await assert.rejects(expired.result, /account_oauth_timeout/);
  console.log('account auth: input validation, secret isolation, logout, email signup, recovery, password update and callback cancellation passed');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
