const { EventEmitter } = require('node:events');
const { createClient } = require('@supabase/supabase-js');
const { createOAuthCallback } = require('./oauth-loopback.cjs');
const config = require('./config.cjs');

const MESSAGES = {
  invalid_credentials: 'Неверная почта или пароль.',
  email_not_confirmed: 'Подтвердите почту по письму перед входом.',
  over_email_send_rate_limit: 'Лимит отправки писем. Попробуйте позже.',
  over_request_rate_limit: 'Слишком много попыток. Попробуйте позже.',
  weak_password: 'Используйте более надёжный пароль: минимум 8 символов.',
  account_oauth_timeout: 'Время входа истекло. Попробуйте ещё раз.',
  account_oauth_cancelled: 'Вход отменён.',
  account_busy: 'Дождитесь завершения текущей операции.',
  invalid_account_input: 'Проверьте почту и пароль.'
};
function userMessage(error) { return MESSAGES[error?.code] || MESSAGES[error?.message] || 'Не удалось выполнить вход. Проверьте интернет и попробуйте ещё раз.'; }
function credentials(email, password) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new Error('invalid_account_input');
  return { email: email.trim(), password };
}

class AccountAuth extends EventEmitter {
  constructor({ storage, clientFactory = createClient, initialProfile = null }) {
    super();
    this.storage = storage;
    this.profile = initialProfile;
    this.busy = false;
    this.closed = false;
    this.callback = null;
    this.notice = null;
    this.passwordRecovery = false;
    this.clientFactory = clientFactory;
    this.installClient();
  }
  installClient() {
    const generation = this.clientGeneration = (this.clientGeneration || 0) + 1;
    const current = () => !this.closed && generation === this.clientGeneration;
    const storage = {
      getItem: key => current() ? this.storage.getItem(key) : Promise.resolve(null),
      setItem: (key, value) => current() ? this.storage.setItem(key, value) : Promise.resolve(),
      removeItem: key => current() ? this.storage.removeItem(key) : Promise.resolve()
    };
    this.client = this.clientFactory(config.url, config.publishableKey, { auth: {
      storage, storageKey: 'aether-supabase-auth-v1', flowType: 'pkce',
      autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, debug: false
    }, global: { fetch: (url, options = {}) => fetch(url, { ...options,
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) } });
    this.subscription = this.client.auth.onAuthStateChange((event, session) => {
      if (this.closed || generation !== this.clientGeneration) return;
      const user = session?.user;
      this.profile = user ? { id: user.id, email: user.email || '', confirmed: Boolean(user.email_confirmed_at) } :
        event === 'INITIAL_SESSION' ? this.profile : null;
      // Never await SDK calls while its auth-state callback holds the internal lock.
      queueMicrotask(() => { if (!this.closed) this.emit('change', this.snapshot()); });
    }).data.subscription;
  }
  snapshot() { return { profile: this.profile ? { ...this.profile } : null, busy: this.busy, persistent: this.storage.persistent,
    message: this.notice, passwordRecovery: this.passwordRecovery }; }
  async run(operation) {
    if (this.busy || this.closed) return { ok: false, message: MESSAGES.account_busy };
    this.busy = true;
    this.notice = null;
    this.emit('change', this.snapshot());
    try { return { ok: true, ...(await operation()) }; }
    catch (error) { return { ok: false, message: userMessage(error) }; }
    finally { this.busy = false; if (!this.closed) this.emit('change', this.snapshot()); }
  }
  signIn(email, password) {
    return this.run(async () => {
      const { error } = await this.client.auth.signInWithPassword(credentials(email, password));
      if (error) throw error;
    });
  }
  signUp(email, password) {
    return this.run(async () => {
      const input = credentials(email, password);
      await this.emailCallback(false, redirect => this.client.auth.signUp({ ...input, options: { emailRedirectTo: redirect } }));
    });
  }
  recover(email) {
    return this.run(async () => {
      credentials(email, 'validation-only');
      await this.emailCallback(true, redirect => this.client.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect }));
    });
  }
  async emailCallback(recovery, send) {
    const callback = await createOAuthCallback({ timeoutMs: 600000 });
    this.callback = callback;
    try {
      const { data, error } = await send(callback.redirectTo);
      if (error) throw error;
      if (data?.session) return;
      this.notice = 'Если отправка доступна, письмо отправлено. Откройте ссылку на этом ПК в течение 10 минут.';
      this.emit('change', this.snapshot());
      const { code, flowId } = await callback.result;
      const exchanged = await this.client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (exchanged.error) throw exchanged.error;
      this.passwordRecovery = recovery;
      this.notice = null;
    } finally { callback.cancel(); this.callback = null; }
  }
  updatePassword(password) {
    return this.run(async () => {
      if (!this.passwordRecovery || typeof password !== 'string' || password.length < 8 || password.length > 1024) throw new Error('invalid_account_input');
      const { error } = await this.client.auth.updateUser({ password });
      if (error) throw error;
      this.passwordRecovery = false;
      return { message: 'Пароль изменён. Ранее доверенные устройства можно отозвать отдельно.' };
    });
  }
  cancelSignIn() { this.callback?.cancel(); }
  signOut() {
    return this.run(async () => {
      const result = await this.client.auth.signOut({ scope: 'local' }).catch(() => ({ error: true }));
      // A failed refresh can make SDK signOut return before clearing the persisted session.
      this.clientGeneration++;
      this.subscription.unsubscribe();
      await this.client.auth.stopAutoRefresh();
      await this.client.removeAllChannels();
      for (const suffix of ['', '-user', '-code-verifier']) await this.storage.removeItem(`aether-supabase-auth-v1${suffix}`);
      this.profile = null;
      this.passwordRecovery = false;
      this.installClient();
      if (result.error) return { message: 'Вы вышли на этом ПК. Облако недоступно; серверный сеанс завершится по сроку действия.' };
    });
  }
  dispose() {
    this.closed = true;
    this.callback?.cancel();
    this.subscription.unsubscribe();
    this.client.auth.stopAutoRefresh();
    this.client.removeAllChannels();
    this.removeAllListeners();
  }
}

module.exports = { AccountAuth, credentials, userMessage };
