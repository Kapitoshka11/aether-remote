const config = require('../lib/account/config.cjs');

(async () => {
  const checks = { supabaseReachable: false, emailEnabled: false,
    emailConfirmationRequired: null, relayConfigured: Boolean(config.relayUrl), relayHealthy: false,
    smtpDelivery: 'requires_real_email_test', redirects: 'requires_real_browser_sign_in' };
  try {
    const response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.publishableKey }, signal: AbortSignal.timeout(15000)
    });
    if (response.ok) {
      const settings = await response.json();
      checks.supabaseReachable = true;
      checks.emailEnabled = settings.external?.email === true;
      checks.emailConfirmationRequired = settings.mailer_autoconfirm === false;
    }
  } catch { /* Only capability booleans are printed; server payloads can include sensitive fields. */ }
  if (config.relayUrl) {
    try {
      const url = new URL(config.relayUrl);
      if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) throw new Error();
      url.protocol = 'https:';
      url.pathname = '/health';
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const health = response.ok ? await response.json() : null;
      checks.relayHealthy = health?.status === 'ok' && health?.protocol === 'aether-account-relay-v1';
    } catch { /* An unavailable relay leaves LAN available. */ }
  }
  console.log(JSON.stringify(checks, null, 2));
  if (!checks.supabaseReachable || !checks.emailEnabled ||
      !checks.emailConfirmationRequired || !checks.relayHealthy) process.exitCode = 1;
})().catch(() => { console.error('Account setup check failed'); process.exitCode = 1; });
