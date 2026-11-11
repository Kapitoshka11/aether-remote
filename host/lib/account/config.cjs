// Account backend configuration is supplied via environment variables.
module.exports = Object.freeze({
  url: String(process.env.AETHER_SUPABASE_URL || '').trim(),
  publishableKey: String(process.env.AETHER_SUPABASE_PUBLISHABLE_KEY || '').trim(),
  relayUrl: String(process.env.AETHER_ACCOUNT_RELAY_URL || '').trim()
});
