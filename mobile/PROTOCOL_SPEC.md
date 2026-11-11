# Aether Remote Protocol Specification v2.0 (Android & Web Parity)

This specification defines the communication protocol between **Aether Mobile Clients** (Android Kotlin / Compose and Web/Capacitor React) and **Aether PC Host**.

---

## 1. 12-Digit Pairing Code Format
The current pairing code consists of exactly 12 digits: `XXX YYY ZZZZZZ`
* `XXX` (Digits 1–3): Subnet Octet 3 (e.g. `168` or `000` or `001`)
* `YYY` (Digits 4–6): Subnet Octet 4 (e.g. `105` or `042`)
* `ZZZZZZ` (Digits 7–12): Host secret suffix (e.g. `654321`)

Android may parse a legacy 9-digit code from an older host QR, but new hosts and manual entry use the 12-digit form.

### Candidate IP Generation
1. Form primary target IP: `<LocalSubnetPrefix>.<XXX>.<YYY>` (e.g., `192.168.0.105`).
2. Sweep primary subnet `0..254` on octet 3 (`<XXX>`).
3. Sweep secondary adjacent subnet `0..254` on alternate octet 3.

---

## 2. Authentication Flow & Session Tokens
### Authentication Request (`AUTH`)
```json
{
  "action": "AUTH",
  "type": "AUTH",
  "pin": "168105654321",
  "sessionToken": "<OptionalExistingToken>",
  "clientName": "Android_Pixel_8",
  "capabilities": ["clipboard-history-v1"]
}
```

### Server Responses
* **AUTH_OK**:
  ```json
  {
    "status": "AUTH_OK",
    "sessionToken": "abc123securetoken",
    "trusted": true,
    "host": "DESKTOP-X1",
    "mac": "00:1A:2B:3C:4D:5E",
    "connectedClients": 1,
    "capabilities": ["file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "clipboard-history-v1", "aether-deck-v1"],
    "tlsFingerprint": "SHA256:A1B2C3..."
  }
  ```
  The optional `trusted` flag reports whether the PC explicitly marked this phone as trusted. A non-trusted or legacy token still produces `AUTH_PENDING` on reconnect. A trusted token connects immediately until it expires or is revoked in the PC settings; Android then clears a rejected token and requires pairing again. `capabilities` is optional for legacy hosts. A client advertises `clipboard-history-v1` when it accepts text-only `CLIPBOARD_ITEM` events. Android requests Deck synchronization only when `aether-deck-v1` is present (or the field is absent for backward compatibility); the standalone Python host omits it and Android displays that the full Windows host is required.
* **AUTH_FAILED**:
  ```json
  {
    "status": "AUTH_FAILED",
    "message": "Invalid PIN"
  }
  ```
* **AUTH_BLOCKED**:
  ```json
  {
    "status": "AUTH_BLOCKED",
    "cooldown": 60,
    "message": "Rate limit exceeded"
  }
  ```

---

## 3. Secure Storage Standard
* **Android**: `EncryptedSharedPreferences` with AES256_GCM key scheme.
* **Web/Capacitor**: Obfuscated/Encrypted localStorage or Capacitor Secure Storage API.
* **Security Rule**: Raw pairing codes **MUST NEVER** be stored in plain text. Session tokens are used for subsequent auto-connections.

---

## 4. Connection Transport & Certificate Pinning
* The LAN control channel is always `wss://`; plaintext `ws://` and `http://` are not supported. The host health endpoint is served through HTTPS on the same port.
* Electron and Python hosts persist a self-signed P-256 certificate and advertise its SHA-256 fingerprint in the pairing QR payload, HTTPS health response, UDP/mDNS discovery record, and `AUTH_OK` response.
* Android pins the advertised fingerprint before authentication. For a manually entered host without an advertised fingerprint, Android accepts only a valid self-signed certificate on the first connection, pins its fingerprint (trust on first use, or TOFU), and requires an exact match on every later connection.
* A certificate mismatch aborts the connection without sending a PIN or session token. Deleting a saved PC also deletes its certificate pin so the user can deliberately pair again after a legitimate certificate replacement.
* The host rejects every application command received before `AUTH_OK`.

---

## 5. Live Audio Streaming Protocol (`AUDIO_CHUNK`)
* Format: 16-bit PCM Audio at 44.1kHz (2 channels).
* Preferred payload: a binary WebSocket message with marker byte `0x02`, followed by PCM bytes. Legacy hosts may send:
  ```json
  {
    "action": "AUDIO_CHUNK",
    "data": "<Base64PCMString>",
    "sampleRate": 44100,
    "channels": 2
  }
  ```
* **Android**: Handled via `android.media.AudioTrack`.
* **Web**: Handled via Web Audio API (`AudioContext`, `AudioBufferSourceNode`).
* `AUDIO_STREAM_STATUS` with `status: "PENDING"` keeps the requested enabled state while host capture starts; only `ERROR` or `enabled: false` disables playback.

---

## 6. Telemetry & Connected Devices Count
* Telemetry Payload (`TELEMETRY`):
  ```json
  {
    "action": "TELEMETRY",
    "data": {
      "cpu": 24,
      "ram": 58,
      "ramUsedGb": 9.3,
      "ramTotalGb": 16.0,
      "connectedClients": 2
    }
  }
  ```
* `connectedClients` badge displays the real-time count of connected mobile clients on the host.

---

## 7. Wake Bridge Protocol v1

Wake Bridge is separate from the authenticated LAN control channel. A phone first enrolls while connected locally by sending `WAKE_ENROLL` with its random 128-bit `deviceId` and Base64 P-256 public key (`publicKeySpki`). The host responds with `WAKE_ENROLL_OK`, the Relay URL, the owner-signed membership certificate, and the registered wake targets. Private keys never leave their device.

A remote wake request uses `type: "wake.request"`, version `1`, 128-bit lowercase-hex group/target/sender/nonce identifiers, `issuedAt`, `expiresAt` no more than 30 seconds later, and a Base64 DER ECDSA P-256/SHA-256 signature. The signature covers the exact newline-delimited canonical representation implemented by `wake/WakeProtocol.kt`, `lib/wake/protocol.cjs`, and `wake-relay/src/protocol.ts`.

The Relay authenticates the membership certificate and signature, rejects expiry, replay, revocation and more than ten requests per phone per minute, then forwards the command only to a Bridge in the same group. The Bridge verifies the command again and sends three 102-byte Magic Packets to private directed broadcasts and `255.255.255.255:9`. `wake.delivery` confirms packet delivery. A matching `host.online` may complete the phone operation for up to 120 seconds after delivery.

Relay WebSockets use `/v1/groups/{groupId}/socket?deviceId=...&certificate=...`; the certificate is Base64URL JSON. Enrollment and revocation use `/v1/groups/{groupId}/members` and `/v1/groups/{groupId}/revoke`. Payloads over 16 KiB are rejected.

Only a session whose `AUTH_OK.trusted` value is `true` may send `WAKE_ENROLL`. Revoking that trusted session also revokes its linked Wake Bridge membership.

---

## 8. Binary screen frames and frame acknowledgements

Before each screen frame, the host sends `{"action":"STREAM_FRAME_META","frameId":<positive integer>,"sentAt":<unix-ms>}` and then sends a binary WebSocket message containing marker byte `0x01` followed by JPEG bytes. Android acknowledges every received frame with `{"action":"FRAME_ACK","frameId":<same integer>,"receivedAt":<unix-ms>,"accepted":<boolean>}`. `accepted` says whether the bounded decoder queue retained the frame. The host calculates round-trip time only from the matching `frameId`, so one lost acknowledgement cannot shift later measurements. For compatibility, a host may accept a legacy acknowledgement without `frameId` and use only its latest dispatch time; there is no Base64 screen-frame payload in protocol v2.

## 9. Chunked files and Aether Deck assets

Every accepted `FILE_CHUNK` receives `FILE_CHUNK_ACK` with `fileId`, `status: "SUCCESS"`, and cumulative `receivedBytes`. Invalid Base64, duplicate/out-of-order offsets, disconnection, and inactivity close the file and remove the partial transfer.

Deck snapshots and state patches expose dynamic variables as dotted keys such as `audio.volume`. A missing `DECK_ASSET_REQUEST` receives `DECK_ASSET_ERROR`; Android negatively caches that hash for the current connection to avoid repeated requests.

## 10. Text clipboard history

When an authenticated client includes `clipboard-history-v1` in its `AUTH.capabilities`, the host watches the Windows text clipboard and sends each changed non-blank value as `{"action":"CLIPBOARD_ITEM","text":"...","source":"pc","createdAt":<unix-ms>}`. Older clients do not receive these unsolicited events. History events are limited to 100,000 characters. Android displays received PC text in memory but does not persist it automatically. It removes PC-sourced entries left by older app versions and stores at most ten entries only when the user explicitly sends text from the phone to the PC. Images and files are outside this capability.

Reading the host clipboard returns `CLIPBOARD_TEXT` (legacy Python hosts may return `CLIPBOARD`). Writing accepts the aliases `SET`, `SET_CLIPBOARD`, and `WRITE_CLIPBOARD`, takes the value strictly from `text` (including an empty string), and returns `CLIPBOARD_WRITE_ACK`; this acknowledgement must not update the displayed PC clipboard or create a `source = "pc"` history item. Android also recognizes legacy `CLIPBOARD_RESPONSE` and `CLIPBOARD_OK` as acknowledgement-only messages.

## 11. Inbound Limits and File Consent

Android closes the socket with WebSocket status `1009` when a text message exceeds 12 MiB, a screen frame exceeds 8 MiB, or an audio frame exceeds 256 KiB. JSON nesting is limited to 64 levels. Image dimensions are limited to 4096 pixels per side and 16 million decoded pixels. A Deck snapshot is limited to 32 decks, 64 pages, 128 controls per page, and 16 actions per control; asset transfers are limited to 128 chunks.

An incoming `FILE_START` is never written immediately. Android validates its identifier, name, and declared size, asks the user to accept or reject it, and sends the corresponding file acknowledgement. The offer expires after 25 seconds. The host waits 30 seconds for the start acknowledgement and uses shorter per-chunk acknowledgement timeouts, so cancelled, stalled, and disconnected transfers cannot remain indefinitely.

## Pairing and clipboard security (September 2026)

The Electron host generates a cryptographically random six-digit secret, including leading zeroes, independently of hardware identity. The pairing code contains twelve decimal digits: the third IPv4 octet padded to three digits, the fourth octet padded to three digits, and the six-digit secret. For example, host 192.168.1.42 and secret 654321 produce 001042654321. Existing IPC field names hardwarePin and pairingCode remain compatible; historical helper names containing Universal9 no longer describe the length. The secret rotates on process start, every ten minutes, and after a pairing decision. Session tokens remain valid after rotation. Update both host and phone together for the twelve-digit UI. Android can still parse a legacy nine-digit QR from an older host.

For first authentication Android requires a SHA256 fingerprint scanned from the PC QR. A manually entered code without a previously authenticated endpoint pin is rejected before AUTH. LAN discovery may inspect an unpinned self-signed certificate only for credential-free /health discovery; discovered and saved-PC metadata never authorize a TLS identity. Saved pins are written only after AUTH_OK agrees with the verified peer certificate. Scanning a new QR is required after the host endpoint or certificate changes.

Clipboard-history-v1 advertises support, not consent. The host's Settings switch for clipboard history is disabled by default and persisted locally. Only when enabled are new CLIPBOARD_ITEM messages sent to authenticated clients advertising that capability. Disabling stops subsequent publication without disconnecting phones; enabling starts from the current clipboard and does not send its pre-existing contents. The PC shows the current recipient count. Explicit clipboard read/write commands remain available as user-requested remote actions. During Deck text input the history poller is paused, reads return the user's previous clipboard text, and concurrent remote writes return ERROR with a retry message. A user's external clipboard change during input is not overwritten by restoration.

PIN throttling continues to limit both the shared network address and the entire server: a self-reported device name cannot safely bypass brute-force protection. Existing valid session tokens bypass these unauthenticated limits. Error text explains that the network address may be shared. Successful PIN attempts no longer reset the global attack budget. Trusted phone settings show the last successful connection time and allow revocation.

The protocol schema defines InboundAction directly from lib/protocol-validation.cjs ALLOWED_ACTIONS. In the host repository run node scripts/sync-protocol-schema.cjs after changing actions; npm test checks that the generated file is current. The broader Action enum also contains host-originated messages; status-only replies are described with their requests.
## Account device authentication and internet transport (September 2026)

Guest AUTH/QR remains available on the ordinary LAN endpoint. Account authentication uses the selected host's P-256 identity and immutable SHA-256 TLS certificate fingerprint from the owner-scoped directory. It never falls back to an unpinned certificate. Account AUTH_OK does not issue a guest sessionToken.

A device ID is lowercase SHA-256 of canonical DER SubjectPublicKeyInfo. The public key is standard padded Base64 for the P-256 key. Grant fingerprints are 64 lowercase hex characters without a prefix; existing TLS responses keep SHA256:UPPERHEX. Normalize only at that boundary. All signed JSON numeric fields must be actual safe integers, not strings or fractional values.

The phone sends ACCOUNT_HELLO with ownerId, hostId, phoneId, sessionId (new UUID for each attempt), optional locally cached grantId, capabilities, and accessToken when enrolling. The host checks a confirmed Supabase user and active owner-scoped devices for first enrollment. Possessing a Supabase token or editing the cloud catalog alone does not confer PC control.

ACCOUNT_CHALLENGE carries version=1, ownerId, hostId, phoneId, sessionId, transport (lan or relay), grantId, a fresh 32-byte base64url nonce, expiresAt in Unix milliseconds, and enrolling. The phone compares the identities, selected transport, grant, expiry and current attempt before signing. ACCOUNT_PROOF repeats the signed fields and adds signature. The host consumes a challenge once, even after an invalid proof, and enforces its 30-second lifetime.

The canonical proof is UTF-8, LF-separated, without a final LF, in this order:

    AETHER_ACCOUNT_AUTH_V1
    ownerId
    hostId
    phoneId
    sessionId
    transport
    grantId
    nonce
    expiresAt

Signatures use ECDSA P-256 with SHA-256, DER encoded and represented as unpadded base64url. During enrollment, both screens show the unsigned big-endian first 32 bits of SHA-256(canonical proof bytes followed by the host SPKI Base64 string as UTF-8), modulo 1,000,000 and padded to six digits. ACCOUNT_APPROVAL_PENDING carries that code. Only explicit approval on the PC produces a locally stored grant and permits AUTH_OK. Cancellation, timeout, owner changes and device revocation reject the attempt. Existing trusted reconnects require a fresh proof but no repeated human approval.

Account AUTH_OK includes authMode=account, grant, hostPublicKeySpki, tlsFingerprint, protocolVersion=2.0 and the existing capabilities/host metadata. A grant has version=1, permissions=control, ownerId, hostId, phoneId, phonePublicKeySpki, hostTlsFingerprint, issuedAt, grantId, positive revision and signature. Its canonical bytes follow this order:

    AETHER_ACCOUNT_GRANT_V1
    ownerId
    hostId
    phoneId
    phonePublicKeySpki
    hostTlsFingerprint
    permissions
    issuedAt
    grantId
    revision

The phone saves the grant only after verifying the host signature, selected owner/devices and the actual TLS peer. The host authorizes from its protected local ledger, never from an unsigned trusted field. Device revocation is sticky. A locally initiated offline revocation is persisted, denies local use immediately and is retried in the cloud later. Logout removes local grants but preserves pending denials. Another offline device learns a remote revocation when it next synchronizes; online directory polling is 45 seconds.

The owner-scoped `aether_devices.network_endpoints` array contains at most sixteen validated, non-loopback IPv4 candidates currently exposed by the host's physical and VPN adapters. Android tries the legacy `lan_ip` and then each distinct candidate for 1.5 seconds, always with the selected PC certificate pin. A stale address with the wrong certificate is skipped without sending credentials. If no direct TLS/WebSocket opens, Android creates a new 90-second owner-scoped `aether_sessions` row and joins the internet relay. The row starts as `pending`, changes to `accepted` after the relay reports ready, and changes to `closed` when the phone bridge closes; only unexpired `pending` rows count toward the limit of eight concurrent connection attempts. An opened direct connection waiting for approval is not interrupted. Supabase Postgres Changes notifies the host; a ten-second bounded reconciliation poll recovers missed notifications before the phone join timeout. A retry refreshes the directory, creates a new session and proof, and never replays an application command. The relay endpoint comes from the release configuration, with Gradle property `aetherAccountRelayUrl` / environment `AETHER_ACCOUNT_RELAY_URL` on Android and the same environment override on Windows. It must be a `wss://` URL with no credentials, query, or fragment. The Electron pairing card still lets a guest operator choose a physical or VPN endpoint for QR pairing. Android listens for VPN as well as physical-network availability before retrying a disconnected session. The Windows firewall rule admits local subnets, RFC 1918 VPN ranges, and the `100.64.0.0/10` carrier-grade NAT range used by overlay VPNs while keeping arbitrary public source addresses blocked. `AUTH_OK.platform` optionally identifies the host as `win32`, `linux`, or `darwin`.

Both devices join the outer WSS endpoint /v1/connect/{sessionId}/{host|phone}, with Supabase access token only in the Authorization header. The relay validates the user, same-owner active host/phone and unexpired session, then requires a fresh P-256 proof of the joining device. The join canonical bytes are:

    AETHER_RELAY_JOIN_V1
    ownerId
    sessionId
    role
    deviceId
    nonce
    expiresAt

The relay sends JSON challenge and, only when both proofs succeed, ready. Joining challenges expire after 15 seconds. An active tunnel is limited by the earlier token expiry and one hour. Subsequent frames are binary: DATA is byte 0, uint32 big-endian cumulative byte offset, then 1..262139 opaque TLS bytes; ACK is byte 1 and uint32 big-endian cumulative consumed-byte count. Maximum frame size is 256 KiB, credit window 1 MiB, endpoint queue limit 2 MiB. The larger carrier frame reduces Worker/WebSocket message overhead without weakening bounded backpressure. Offsets must be contiguous; ACKs must be monotonic and no greater than bytes sent. Overflow, malformed frames and closed peers terminate both sides. A stream ends before 32-bit byte counters wrap; this bounds a single direction to less than 4 GiB.

Inside that carrier Android opens the existing TLS/WSS protocol to /account-relay/{sessionId}. Its local one-shot loopback bridge is only a transport endpoint, never a TLS identity. The host creates a TLS ingress bound to that outer session, checks the path and accepts only the matching phone's account proof. Guest AUTH cannot enter through this ingress. Screen/audio/file bytes remain encrypted between Android and the host.

Local transport evidence: AccountRelayIntegrationTest starts test/account_android_relay_fixture.cjs from the sibling host, verifies an actual Android-to-Node 1 MiB TLS/WSS round trip and rejects an incorrect PC certificate. The fixture mocks cloud admission, so it does not establish that public deployment or real Supabase login is configured. A physical phone on a different network remains a separate acceptance check.
