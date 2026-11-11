# Aether Remote Host Protocol Specification

This document defines the unified WebSocket and PeerJS communication protocol used between the **Aether Remote Host (Electron/Python)** and **Aether Mobile Clients**.

LAN messages are transmitted as JSON strings or bounded binary frames over TLS-encrypted WebSockets (`wss://`). The HTTPS health endpoint, UDP/mDNS discovery record, pairing QR payload, and successful authentication response all advertise the persistent host certificate fingerprint as `SHA256:` followed by 64 hexadecimal characters. Plaintext LAN WebSockets are not supported.

---

## 1. Connection & Authentication

When a client connects, it must authenticate before executing any command. The server enforces rate limiting/brute force protection (3 max failed attempts, followed by a 60-second cooldown block).

### Action: `AUTH`
Used to log in via a PIN or session token.

**Request:**
```json
{
  "action": "AUTH",
  "pin": "123456",            // Optional (if using PIN)
  "sessionToken": "abc123xyz", // Optional (if using existing session token)
  "deviceModel": "iPhone 15"   // Recommended for logging/display
}
```

**Successful Response:**
```json
{
  "status": "AUTH_OK",
  "sessionToken": "new_session_token_123",
  "trusted": false,
  "connectedClients": 1,
  "capabilities": ["file-transfer-v2", "binary-screen-v1", "binary-audio-pcm16-v1", "clipboard-history-v1", "aether-deck-v1"],
  "tlsFingerprint": "SHA256:A1B2C3..."
}
```

`trusted` is optional for older clients. A token with `trusted: false` still requires local PC approval on reconnect. The PC grants `trusted: true` only when its pairing checkbox is explicitly selected; such a token reconnects without another prompt until it expires or is removed from **Доверенные телефоны**. Legacy tokens default to non-trusted.

`capabilities` is optional for legacy hosts. `tlsFingerprint` must match the certificate observed by the client; a mismatch aborts authentication. The Android client pins the QR/discovery fingerprint before sending credentials, or uses trust on first use for a manually entered private-LAN address. A client advertises `clipboard-history-v1` when it accepts text-only clipboard change events. The Electron host advertises `aether-deck-v1`; the standalone Python host intentionally omits it and answers any `DECK_*` request with `DECK_UNAVAILABLE`, because Deck configuration and action providers live in the full host. Clients must show this limitation instead of retrying synchronization indefinitely.

No control, clipboard, streaming, file, or Deck command may execute before this `AUTH_OK` exchange completes.

**Failed Response (Incorrect PIN):**
```json
{
  "status": "AUTH_FAILED",
  "error": "Incorrect PIN or pairing key",
  "remainingAttempts": 2
}
```

**Blocked Response (Too Many Failed Attempts):**
```json
{
  "status": "AUTH_BLOCKED",
  "error": "Brute force blocked. Too many attempts. Blocked for 60 seconds."
}
```

---

## 2. Telemetry & Host Status

### Action: `GET_TELEMETRY`
Retrieve the system performance metrics and media player state.

**Request:**
```json
{
  "action": "GET_TELEMETRY"
}
```

**Response (Type: `TELEMETRY`):**
```json
{
  "action": "TELEMETRY",
  "data": {
    "cpu": 12.5,                // CPU Usage %
    "ram": 45.2,                // RAM Usage %
    "ramUsedGb": 7.2,           // RAM Used in GB
    "ramTotalGb": 16.0,         // RAM Total in GB
    "net_upload": 0.45,         // upload speed in MB/s
    "net_download": 2.12,       // download speed in MB/s
    "hostname": "MY-HOST-PC",   // Name of the host
    "uptime": 12345,            // System uptime in seconds
    "track": "Song Title",      // Currently playing media title
    "artist": "Artist Name",    // Currently playing media artist
    "isPlaying": true,          // Media playback status
    "connectedClients": 1       // Total count of authenticated clients
  }
}
```

---

## 3. Screen Streaming (Adaptive Quality)

### Action: `STREAM_FRAME`
Subscribe/unsubscribe to screen frame capture broadcaster.

**Request:**
```json
{
  "action": "STREAM_FRAME",
  "start": true,              // True to start streaming, false to stop
  "command": "START",         // Alternatively "START" or "STOP"
  "monitorIndex": 0,          // Selected monitor to capture (0, 1, 2...)
  "quality": 70,              // Initial JPEG quality compression factor [10-100]
  "resolution": "720p"        // Target resolution mode: "1080p", "720p", "480p"
}
```

**Frame Update (Broadcaster to Client):** `{"action":"STREAM_FRAME_META","frameId":42,"sentAt":1723180000000}` followed immediately by a binary WebSocket message whose first byte is `0x01` and whose remaining bytes are a JPEG image. Frames are sent in order. The host keeps a bounded map from `frameId` to dispatch time for adaptive-quality RTT calculations.

### Action: `FRAME_ACK` (Adaptive Controller)
Sent by clients after receiving every binary frame. Used to dynamically adjust stream resolution and quality. `frameId` must echo the identifier from the preceding `STREAM_FRAME_META`; `receivedAt` is informational. `accepted` reports whether the client's bounded decoder queue accepted the frame. A dropped decoder frame is still acknowledged, and a missing acknowledgement does not affect later frame measurements.

**Request:**
```json
{
  "action": "FRAME_ACK",
  "frameId": 42,
  "receivedAt": 1723180000150,
  "accepted": true
}
```

---

## 4. Audio Streaming (Loopback)

### Action: `AUDIO_STREAM`
Enables or disables capture of system audio (loopback recording) and streaming PCM chunks.

**Request:**
```json
{
  "action": "AUDIO_STREAM",
  "enabled": true
}
```

**Status Response:**
```json
{
  "action": "AUDIO_STREAM_STATUS",
  "enabled": true,
  "status": "PENDING"
}
```
`PENDING` means the enable command was accepted and capture initialization is still in progress. The client keeps audio enabled until a later `SUCCESS`, an explicit disable response, or `ERROR`.

**Audio Chunk Broadcast (Broadcaster to Client):**
```json
{
  "action": "AUDIO_CHUNK",
  "data": "base64_PCM_data_here...", // PCM 16-bit stereo chunks
  "sampleRate": 44100,
  "channels": 2
}
```

---

## 5. Chunked File Exchange

Used to send files in a robust, timeout-safe, chunked fashion.

### Action: `FILE_START`
Initiate transfer.

**Request:**
```json
{
  "action": "FILE_START",
  "fileName": "document.pdf",
  "fileSize": 1048576,
  "chunkSize": 65536
}
```

**Response:**
```json
{
  "action": "FILE_START_ACK",
  "fileId": "file_uuid_abc123",
  "status": "SUCCESS"
}
```

### Action: `FILE_CHUNK`
Transmit block of file data.

**Request:**
```json
{
  "action": "FILE_CHUNK",
  "fileId": "file_uuid_abc123",
  "chunkIndex": 0,
  "data": "base64_chunk_data..."
}
```

**Response:**
```json
{
  "action": "FILE_CHUNK_ACK",
  "fileId": "file_uuid_abc123",
  "chunkIndex": 0,
  "status": "SUCCESS",
  "receivedBytes": 65536
}
```

### Action: `FILE_END`
Finalize transfer.

**Request:**
```json
{
  "action": "FILE_END",
  "fileId": "file_uuid_abc123"
}
```

**Response:**
```json
{
  "action": "FILE_END_ACK",
  "fileId": "file_uuid_abc123",
  "status": "SUCCESS"
}
```

---

## 6. System Command Execution

### Action: `KILL_PROCESS`
Terminates a process by Name or PID.

**Request:**
```json
{
  "action": "KILL_PROCESS",
  "command": "notepad",      // Can be name or PID
  "process": "notepad",      // Alternative field
  "process_name": "notepad"  // Alternative field
}
```

**Response:**
```json
{
  "action": "KILL_PROCESS_RESPONSE",
  "status": "SUCCESS", // Or "ERROR"
  "output": "Successfully terminated process notepad"
}
```

### Action: `SEND_TOAST`
Triggers a notification on the Host PC.

**Request:**
```json
{
  "action": "SEND_TOAST",
  "title": "Aether Remote",
  "text": "Hello World!",
  "command": "Hello World!" // Alternative field
}
```

**Response:**
```json
{
  "action": "SEND_TOAST_RESPONSE",
  "status": "SUCCESS",
  "message": "TOAST_SENT"
}
```

## 7. Power & Media Control

### Action: `POWER`
Triggers system power state commands.

**Request:**
```json
{
  "action": "POWER",
  "command": "LOCK" // Can be: LOCK, SLEEP, SHUTDOWN, REBOOT, ALT_F4
}
```

**Response:**
```json
{
  "action": "POWER_RESPONSE",
  "status": "POWER_EXECUTED",
  "command": "LOCK"
}
```

### Action: `MEDIA`
Controls PC media state.

**Request:**
```json
{
  "action": "MEDIA",
  "command": "VOL_UP", // VOL_UP, VOL_DOWN, VOL_MUTE, NEXT_TRACK, PREV_TRACK, PLAY_PAUSE, VOLUME_SET
  "val": 50            // Volume target (0-100) for VOLUME_SET
}
```

**Response:**
```json
{
  "action": "MEDIA_RESPONSE",
  "status": "MEDIA_EXECUTED",
  "command": "VOL_UP"
}
```

---

## 8. Clipboard Sync

### Action: `CLIPBOARD` or `SYSTEM` with clipboard command
Synchronizes text payload in the system clipboard.

**Request (Read/Get):**
```json
{
  "action": "CLIPBOARD",
  "command": "GET_CLIPBOARD" // or "READ_CLIPBOARD", "GET"
}
```

**Response (Clipboard content read):**
```json
{
  "action": "CLIPBOARD_TEXT",
  "text": "Text from host's clipboard"
}
```

**Request (Write/Set):**
```json
{
  "action": "CLIPBOARD",
  "command": "WRITE_CLIPBOARD", // or "SET", "SET_CLIPBOARD"
  "text": "Text to write to host clipboard"
}
```

**Response (Clipboard content written):**
```json
{
  "action": "CLIPBOARD_WRITE_ACK",
  "status": "CLIPBOARD_WRITTEN",
  "text": "Text to write to host clipboard"
}
```

`CLIPBOARD_WRITE_ACK` only confirms a write initiated by the phone. Clients must not treat it as clipboard content copied on the PC. Older `CLIPBOARD_RESPONSE` and `CLIPBOARD_OK` acknowledgements may be accepted for compatibility but have the same acknowledgement-only meaning.

### Event: `CLIPBOARD_ITEM`

After authentication, a client that sent `clipboard-history-v1` in `AUTH.capabilities` receives each new non-blank Windows text clipboard value:

```json
{
  "action": "CLIPBOARD_ITEM",
  "text": "New text copied on the PC",
  "source": "pc",
  "createdAt": 1787058000000
}
```

The Android client keeps unsolicited PC clipboard text in memory only and removes PC-sourced history left by older versions. It persists an entry only after the user explicitly sends phone text to the PC, combines duplicate values, and keeps at most ten entries. Hosts and clients ignore history entries longer than 100,000 characters. This capability does not transfer clipboard images or files.

### Resource limits and incoming file consent

Android rejects text WebSocket messages above 12 MiB, binary screen frames above 8 MiB, binary audio frames above 256 KiB, and JSON nested more than 64 levels. Before writing an incoming file, Android validates `FILE_START`, displays a user confirmation dialog, and sends an accept or rejection acknowledgement. The offer expires after 25 seconds. The host waits 30 seconds for the initial acknowledgement and applies bounded timeouts to all later chunks and completion acknowledgements.

## 9. Aether Deck

Aether Deck traffic is available only after the normal `AUTH_OK` handshake. The host owns configuration revisions and execution state.

- `DECK_SYNC_REQUEST` requests a complete `DECK_SNAPSHOT`.
- `DECK_PATCH` replaces configuration only when `fromRevision` matches the phone revision; otherwise the phone requests a new snapshot.
- `DECK_TRIGGER` includes `triggerId`, `revision`, `deckId`, `pageId`, and `controlId`.
- `DECK_SLIDER` includes the same required identifiers as `DECK_TRIGGER`, plus a monotonically increasing `sequence` and numeric `value`.
- `DECK_NAVIGATE` changes the active page without executing an action.
- `DECK_STATE_PATCH` carries live control states and dotted dynamic variables.
- `DECK_ACTION_RESULT` reports `running`, `success`, an execution error, `STALE_REVISION`, or `CONTROL_NOT_FOUND`.
- `DECK_ASSET_REQUEST` requests a SHA-256 asset. The host responds with ordered `DECK_ASSET_CHUNK` messages containing Base64 data, or one `DECK_ASSET_ERROR` with the requested hash when the asset is unavailable.
- `system.launchApplication` is a Deck provider action with `parameters.path`, an array `parameters.arguments`, and optional `parameters.workingDirectory`. Executables are launched with structured arguments; shortcuts and associated files use the Windows shell without command interpolation.

Arbitrary shell and PowerShell actions are not part of the production protocol. Saved legacy controls of those types are rejected. Launching a configured executable requires interactive confirmation on the PC before each execution; other allowlisted controls execute after authentication.

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
