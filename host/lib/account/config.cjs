// Supabase publishable keys are public; access is enforced by user JWTs and RLS.
module.exports = Object.freeze({
  url: 'https://lihklgocvacchmoirosg.supabase.co',
  publishableKey: 'sb_publishable_SRfRkItYH9bE0q5f6pnolw_zGphWNeE',
  relayUrl: String(
    process.env.AETHER_ACCOUNT_RELAY_URL || 'wss://aether-account-relay.akulenoklaha.workers.dev'
  ).trim()
});
