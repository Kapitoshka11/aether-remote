# Aether Wake Relay

This free Cloudflare Worker routes authenticated Wake Bridge commands. It cannot wake a PC itself; one enrolled Windows host in the home must remain running as the Bridge.

Run `npm test` and `npm run typecheck` before deployment. Then authenticate Wrangler locally with `npx wrangler login` and deploy with `npx wrangler deploy`. Wrangler prints the Worker HTTPS URL. Set that URL for the Windows host as the user environment variable `AETHER_WAKE_RELAY_URL`, restart Aether Remote, and enable Aether Wake Bridge in Settings. Do not put API tokens, recovery codes, private keys, pairing PINs, or router credentials into this folder.

The free deployment uses the SQLite Durable Object declared in `wrangler.jsonc`. Keep the existing `v1` migration and `HomeGroup` class name for upgrades. The Relay enforces signed 30-second requests, one-use nonces, group isolation, revocation, ten wake commands per phone per minute, 16 KiB payload limits, and automatic expiry cleanup.

### Security event counters

With Workers observability enabled, the relay emits structured `wake_security` log events for `invalid_signature` and `rate_limited`. Counts are per active Durable Object instance and one-minute window; they reset on hibernation/restart and are operational signals, not durable billing counters. The first event is a notice; the tenth and subsequent power-of-two counts have `severity: "alert"`. Filter Workers logs by this event and severity to identify attack bursts. Logs contain only aggregate counts, code and window time, never group/device IDs, nonces, keys or payloads. No external notification destination is configured.
