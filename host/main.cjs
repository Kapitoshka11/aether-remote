const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, clipboard, desktopCapturer, Notification, safeStorage, session, shell, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const os = require('os');
const crypto = require('crypto');
const { exec, execFile, execSync, spawn } = require('child_process');
const https = require('https');
const WebSocket = require('ws');
const { createWindowsAudioController } = require('./lib/windows-audio.cjs');
const { createWindowsMediaController } = require('./lib/windows-media.cjs');
const { createWindowsInputController } = require('./lib/windows-input.cjs');
const { createDeckStore } = require('./lib/aether-deck/store.cjs');
const { createProviderRegistry } = require('./lib/aether-deck/provider-registry.cjs');
const { createMacroEngine } = require('./lib/aether-deck/macro-engine.cjs');
const { createAetherDeckService } = require('./lib/aether-deck/service.cjs');
const { createDeckAssetStore } = require('./lib/aether-deck/assets.cjs');
const { selectDeckAsset } = require('./lib/aether-deck/asset-selection.cjs');
const { normalizeTokenInfo, decideApproval, handleAuthAttempt: evaluateAuthAttempt } = require('./lib/auth-policy.cjs');
const { isPrivateOrLoopbackHostname, physicalIpv4Entries, advertisableIpv4Entries } = require('./lib/network-policy.cjs');
const { createNetworkChangeMonitor } = require('./lib/network-change-monitor.cjs');
const { applyStreamPreferences, recordFrameDispatch, resolveFrameSentAt } = require('./lib/stream-policy.cjs');
const { exportDeckPackage, importDeckPackage } = require('./lib/aether-deck/package.cjs');
const { createAetherProvider } = require('./lib/aether-deck/providers/aether.cjs');
const { createSystemProvider } = require('./lib/aether-deck/providers/system.cjs');
const { createInputProvider } = require('./lib/aether-deck/providers/input.cjs');
const { createAudioProvider } = require('./lib/aether-deck/providers/audio.cjs');
const { createNavigationProvider } = require('./lib/aether-deck/providers/navigation.cjs');
const { createObsClient, validateObsWebSocketUrl } = require('./lib/aether-deck/obs-client.cjs');
const { createObsProvider } = require('./lib/aether-deck/providers/obs.cjs');
const {
  abortOutgoingRendererTransfers,
  awaitOutgoingFileAck,
  handleOutgoingFileAck,
  handleOutgoingClientClosed
} = require('./lib/outgoing-renderer-transfers.cjs');
const { createForegroundAppObserver } = require('./lib/aether-deck/foreground-app.cjs');
const { createIdentityStore: createWakeIdentityStore } = require('./lib/wake/identity-store.cjs');
const { createWakeGroupStore } = require('./lib/wake/group-store.cjs');
const { createWakeEnrollment } = require('./lib/wake/enrollment.cjs');
const { createWakeRelayApi } = require('./lib/wake/relay-api.cjs');
const { createWakeRelayClient } = require('./lib/wake/relay-client.cjs');
const { createWakeBridge } = require('./lib/wake/bridge.cjs');
const { collectBroadcastTargets, sendMagicPacket: sendWakeMagicPacket } = require('./lib/wake/magic-packet.cjs');
const { createWakeHostService } = require('./lib/wake/host-service.cjs');
const { clipboardWriteText, validateInboundMessage } = require('./lib/protocol-validation.cjs');
const { incomingTransferTimeoutMs, outgoingFileAckTimeoutMs, OUTGOING_TRANSFER_TIMEOUT_MS } = require('./lib/file-transfer-policy.cjs');
const { createTrustedIpcRegistrar } = require('./lib/ipc-security.cjs');
const { presentPairingRequest } = require('./lib/ui/pairing-request.cjs');
const { loadOrCreateTlsIdentity } = require('./lib/tls-identity.cjs');
const { AccountHostService } = require('./lib/account/host-service.cjs');
let accountHostService = null;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  console.log('[SYSTEM] Another instance of Aether Remote is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function getFallbackHardwareUuid() {
  const interfaces = os.networkInterfaces();
  let macs = '';
  for (const addrs of Object.values(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
        macs += addr.mac;
      }
    }
  }
  return `AETHER-${os.hostname()}-${macs || 'SYSTEM_DEFAULT'}`;
}

function getHardwareBoundPin(uuidStr) {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function generateSmartPin(ipAddr, salt) {
  const targetIp = (ipAddr || '192.168.1.50').trim();
  const parts = targetIp.split('.');
  const lastOctetStr = parts.length > 0 ? parts[parts.length - 1] : '50';
  const octetNum = parseInt(lastOctetStr, 10);
  const octetPadded = isNaN(octetNum) ? '050' : octetNum.toString().padStart(3, '0');

  let saltStr = salt;
  if (!saltStr || saltStr.toString().length !== 3) {
    const rand = Math.floor(100 + Math.random() * 900);
    saltStr = rand.toString();
  }
  return `${octetPadded}${saltStr}`;
}

function getPrimaryLocalIp() {
  const interfaces = os.networkInterfaces();
  const addresses = physicalIpv4Entries(interfaces).map(({ entry }) => entry.address);
  const preferred = addresses.find(address => address.startsWith('192.168.'));
  if (preferred) return preferred;
  if (addresses.length) return addresses[0];

  return '127.0.0.1';
}

function getPrimaryMacAddress() {
  for (const { entry } of physicalIpv4Entries(os.networkInterfaces())) {
    if (entry.mac && entry.mac !== '00:00:00:00:00:00') return entry.mac.toUpperCase();
  }
  return '';
}

function getNetworkEndpoints(primaryAddress = getPrimaryLocalIp()) {
  return advertisableIpv4Entries(os.networkInterfaces())
    .map(({ name, entry }) => ({ address: entry.address, interfaceName: name }))
    .sort((left, right) => {
      if (left.address === primaryAddress) return -1;
      if (right.address === primaryAddress) return 1;
      return left.interfaceName.localeCompare(right.interfaceName);
    });
}

function isPrivateLanHostname(hostname) {
  return isPrivateOrLoopbackHostname(hostname);
}

const requestedTestPort = process.env.AETHER_RUNTIME_TEST === '1' ? Number(process.env.AETHER_TEST_PORT) : NaN;
const PORT = Number.isSafeInteger(requestedTestPort) && requestedTestPort >= 1024 && requestedTestPort <= 65535
  ? requestedTestPort
  : 8080;
let LOCAL_IP = getPrimaryLocalIp();
let LOCAL_MAC = getPrimaryMacAddress();
let NETWORK_ENDPOINTS = getNetworkEndpoints(LOCAL_IP);
let tlsFingerprint = '';

let HARDWARE_UUID = getFallbackHardwareUuid();
let HARDWARE_PIN = getHardwareBoundPin(HARDWARE_UUID);

function encodeUniversal9Code(ipAddress, pin3) {
  const parts = (ipAddress || '192.168.1.50').trim().split('.');
  const oct3 = parts.length >= 3 ? parseInt(parts[2], 10) : 1;
  const oct4 = parts.length >= 4 ? parseInt(parts[3], 10) : 50;
  
  const p1 = (isNaN(oct3) ? 1 : oct3).toString().padStart(3, '0');
  const p2 = (isNaN(oct4) ? 50 : oct4).toString().padStart(3, '0');
  
  let p3 = (pin3 || '').toString().replace(/\D/g, '');
  if (p3.length !== 6) {
    p3 = getHardwareBoundPin('SYSTEM_DEFAULT');
  }
  
  const code9 = `${p1}${p2}${p3}`;
  const formattedCode = `${p1} - ${p2} - ${p3}`;
  return { code9, formattedCode, p1, p2, p3 };
}

let UNIVERSAL_9_PAYLOAD = encodeUniversal9Code(LOCAL_IP, HARDWARE_PIN);
let UNIVERSAL_9_CODE = UNIVERSAL_9_PAYLOAD.code9;
let ENCODED_PAIRING_CODE = UNIVERSAL_9_CODE;

function refreshLocalNetworkIdentity() {
  const nextIp = getPrimaryLocalIp();
  const nextMac = getPrimaryMacAddress();
  const nextEndpoints = getNetworkEndpoints(nextIp);
  const endpointsChanged = JSON.stringify(nextEndpoints) !== JSON.stringify(NETWORK_ENDPOINTS);
  if (nextIp === LOCAL_IP && nextMac === LOCAL_MAC && !endpointsChanged) return false;
  LOCAL_IP = nextIp;
  LOCAL_MAC = nextMac;
  NETWORK_ENDPOINTS = nextEndpoints;
  UNIVERSAL_9_PAYLOAD = encodeUniversal9Code(LOCAL_IP, HARDWARE_PIN);
  UNIVERSAL_9_CODE = UNIVERSAL_9_PAYLOAD.code9;
  ENCODED_PAIRING_CODE = UNIVERSAL_9_CODE;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hardware-info-updated', {
      hardwarePin: HARDWARE_PIN,
      pairingCode: ENCODED_PAIRING_CODE,
      ipAddress: LOCAL_IP,
      networkEndpoints: NETWORK_ENDPOINTS,
      macAddress: LOCAL_MAC,
      tlsFingerprint
    });
  }
  return true;
}
const authenticatedTokens = new Map();
const failedAttemptsMap = new Map();
let globalFailedAuthAttempts = [];
const pendingPairingRequests = new Map();

const tokensFilePath = path.join(app.getPath('userData'), 'aether_tokens.dat');
const legacyTokensFilePath = path.join(os.homedir(), '.aether_tokens.json');

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
const {
  PREAUTH_TIMEOUT_MS,
  isGuestSessionActive,
  scheduleAbsoluteExpiry,
  connectionAdmission
} = require('./lib/websocket-session-policy.cjs');

function loadPersistedTokens() {
  try {
    const fs = require('fs');
    let raw = '';
    let loadedLegacyFile = false;
    if (fs.existsSync(tokensFilePath) && safeStorage.isEncryptionAvailable()) {
      const encrypted = Buffer.from(fs.readFileSync(tokensFilePath, 'utf8'), 'base64');
      raw = safeStorage.decryptString(encrypted);
    } else if (fs.existsSync(legacyTokensFilePath)) {
      raw = fs.readFileSync(legacyTokensFilePath, 'utf8');
      loadedLegacyFile = true;
    }

    if (raw) {
      const tokensData = JSON.parse(raw);
      const now = Date.now();
      if (Array.isArray(tokensData)) {
        tokensData.forEach(tok => {
          if (typeof tok === 'string') {
            authenticatedTokens.set(tok, normalizeTokenInfo(null, now, TOKEN_TTL_MS));
          } else if (tok && tok.token) {
            if (!tok.expiresAt || tok.expiresAt > now) {
              authenticatedTokens.set(tok.token, normalizeTokenInfo(tok, now, TOKEN_TTL_MS));
            }
          }
        });
      } else if (typeof tokensData === 'object' && tokensData !== null) {
        Object.entries(tokensData).forEach(([tok, val]) => {
          if (val && typeof val === 'object') {
            if (!val.expiresAt || val.expiresAt > now) {
              authenticatedTokens.set(tok, normalizeTokenInfo(val, now, TOKEN_TTL_MS));
            }
          } else {
            authenticatedTokens.set(tok, normalizeTokenInfo(null, now, TOKEN_TTL_MS));
          }
        });
      }
      console.log(`[AUTH] Successfully loaded ${authenticatedTokens.size} valid session tokens.`);
      if (loadedLegacyFile) {
        savePersistedTokens();
        try { fs.unlinkSync(legacyTokensFilePath); } catch (e) {}
      }
    }
  } catch (e) {
    console.error('[AUTH] Failed to load persisted tokens:', e.message);
  }
}

function savePersistedTokens() {
  try {
    const fs = require('fs');
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[AUTH] OS encryption is unavailable; session tokens will remain memory-only.');
      return;
    }
    const tokensObj = {};
    const now = Date.now();
    for (const [tok, info] of authenticatedTokens.entries()) {
      if (info && info.expiresAt > now) {
        tokensObj[tok] = info;
      }
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(tokensObj));
    fs.writeFileSync(tokensFilePath, encrypted.toString('base64'), { encoding: 'utf8', mode: 0o600 });
  } catch (e) {
    console.error('[AUTH] Failed to save persisted tokens:', e.message);
  }
}

setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [tok, info] of authenticatedTokens.entries()) {
    if (info && info.expiresAt && info.expiresAt <= now) {
      authenticatedTokens.delete(tok);
      if (wss?.clients) {
        for (const client of wss.clients) {
          if (client.sessionToken === tok) client.close(1008, 'Session token expired');
        }
      }
      changed = true;
    }
  }
  if (changed) savePersistedTokens();

  const ONE_DAY_MS = 24 * 3600 * 1000;
  for (const [ip, info] of failedAttemptsMap.entries()) {
    const activityTime = info.lastActivity || info.blockedUntil || now;
    if (now - activityTime > ONE_DAY_MS) {
      failedAttemptsMap.delete(ip);
    }
  }
}, 3600 * 1000);

function timingSafeTextEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenPublicId(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function getTrustedTokenViews(now = Date.now()) {
  return Array.from(authenticatedTokens.entries())
    .filter(([, info]) => info?.trusted === true && info.expiresAt > now)
    .map(([token, info]) => ({ token: tokenPublicId(token), ...info }));
}

function findTokenByPublicId(publicId) {
  const normalized = String(publicId || '');
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
  for (const token of authenticatedTokens.keys()) {
    if (timingSafeTextEqual(tokenPublicId(token), normalized.toLowerCase())) return token;
  }
  return null;
}

function findSessionToken(passedToken) {
  if (!passedToken) return null;
  for (const token of authenticatedTokens.keys()) {
    if (timingSafeTextEqual(token, passedToken)) return token;
  }
  return null;
}

function authenticateSession(enteredPin, passedToken) {
  const now = Date.now();
  const matchedToken = findSessionToken(passedToken);
  if (matchedToken) {
    const info = authenticatedTokens.get(matchedToken);
    if (info && info.expiresAt && info.expiresAt <= now) {
      authenticatedTokens.delete(matchedToken);
      savePersistedTokens();
      return { success: false, reason: 'Session token has expired' };
    }
    return { success: true, token: matchedToken, isNewToken: false, trusted: info?.trusted === true };
  }

  const cleanPin = (enteredPin || '').toString().trim().replace(/\s|-/g, '');
  if (!cleanPin) {
    return { success: false, reason: 'Empty PIN provided' };
  }

  const pairingAddresses = [...new Set([LOCAL_IP, ...NETWORK_ENDPOINTS.map(endpoint => endpoint.address)])];
  const isMatch = pairingAddresses
    .map(address => encodeUniversal9Code(address, HARDWARE_PIN).code9)
    .some(pairingCode => timingSafeTextEqual(cleanPin, pairingCode));

  if (isMatch) {
    const newToken = 'session-' + crypto.randomBytes(32).toString('hex');
    return { success: true, token: newToken, isNewToken: true };
  }

  return { success: false, reason: 'Incorrect PIN or pairing code' };
}

function handleAuthAttempt(identifier, enteredPin, passedToken) {
  const now = Date.now();
  if (passedToken) {
    const tokenResult = authenticateSession('', passedToken);
    if (tokenResult.success) return { ...tokenResult, isNewToken: false };
  }
  globalFailedAuthAttempts = globalFailedAuthAttempts.filter(timestamp => now - timestamp < 60_000);
  if (globalFailedAuthAttempts.length >= 20) {
    return { success: false, isBlocked: true, reason: 'Global authentication rate limit reached', remainingAttempts: 0, cooldown: 60 };
  }
  const result = evaluateAuthAttempt({
    identifier, enteredPin, passedToken, failures: failedAttemptsMap, authenticate: authenticateSession
  });
  if (!result.success) globalFailedAuthAttempts.push(now);
  return result;
}

function requestHostApproval(mainWindow, clientIp, description, type = 'ws', onCreated = null) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed() || pendingPairingRequests.size > 0) {
      resolve({ approved: false, trusted: false });
      return;
    }

    const requestId = `ws-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    let cancelDelivery = () => {};
    const timeout = setTimeout(() => {
      cancelDelivery();
      pendingPairingRequests.delete(requestId);
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send('pairing-cancel', { requestId });
      resolve({ approved: false, trusted: false });
    }, 30000);

    pendingPairingRequests.set(requestId, {
      resolve: (response) => {
        cancelDelivery();
        clearTimeout(timeout);
        pendingPairingRequests.delete(requestId);
        const approved = typeof response === 'object' ? response.approved === true : response === true;
        const trusted = type === 'pairing' && typeof response === 'object' && response.trusted === true;
        resolve({ approved, trusted: approved && trusted });
      }
    });
    if (typeof onCreated === 'function') onCreated(requestId);
    const payload = {
      requestId,
      ip: clientIp,
      deviceModel: String(description || 'Aether mobile client').slice(0, 200),
      type: String(type).slice(0, 24)
    };
    cancelDelivery = presentPairingRequest(mainWindow, payload, () => pendingPairingRequests.has(requestId));
  });
}

function rotatePairingSecret() {
  HARDWARE_PIN = getHardwareBoundPin(HARDWARE_UUID);
  updateHardwareInfo(HARDWARE_UUID);
}
setInterval(rotatePairingSecret, 10 * 60_000).unref();

function updateHardwareInfo(uuid) {
  HARDWARE_UUID = uuid;
  // Hardware discovery must not rotate the current session pairing secret.
  UNIVERSAL_9_PAYLOAD = encodeUniversal9Code(LOCAL_IP, HARDWARE_PIN);
  UNIVERSAL_9_CODE = UNIVERSAL_9_PAYLOAD.code9;
  ENCODED_PAIRING_CODE = UNIVERSAL_9_CODE;
  console.log('[SYSTEM] Hardware-bound pairing identity updated.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hardware-info-updated', {
      hardwareUuid: HARDWARE_UUID,
      hardwarePin: HARDWARE_PIN,
      pairingCode: ENCODED_PAIRING_CODE,
      tlsFingerprint
    });
  }
}

function asyncInitializeHardwareInfo() {
  if (process.platform === 'win32') {
    exec('powershell -NoProfile -Command "(Get-CimInstance -Class Win32_ComputerSystemProduct).UUID"', { timeout: 4000 }, (err, stdout) => {
      let uuid = '';
      if (!err && stdout) {
        uuid = stdout.trim();
      }
      if (uuid && uuid.length > 5) {
        updateHardwareInfo(uuid);
        return;
      }
      exec('wmic csproduct get uuid', { timeout: 4000 }, (err2, stdout2) => {
        let wmicUuid = '';
        if (!err2 && stdout2) {
          const lines = stdout2.trim().split('\n');
          if (lines.length > 1) {
            wmicUuid = lines[1].trim();
          }
        }
        if (wmicUuid && wmicUuid.length > 5) {
          updateHardwareInfo(wmicUuid);
          return;
        }
        exec('powershell -NoProfile -Command "(Get-ItemProperty -Path \'HKLM:\\SOFTWARE\\Microsoft\\Cryptography\').MachineGuid"', { timeout: 4000 }, (err3, stdout3) => {
          let guid = '';
          if (!err3 && stdout3) {
            guid = stdout3.trim();
          }
          if (guid && guid.length > 5) {
            updateHardwareInfo(guid);
            return;
          }
          exec('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { timeout: 4000 }, (err4, regOut) => {
            if (!err4 && regOut) {
              const match = regOut.match(/MachineGuid\s+REG_SZ\s+(\S+)/i);
              if (match && match[1]) {
                updateHardwareInfo(match[1].trim());
              }
            }
          });
        });
      });
    });
  }
}

let prevCpus = os.cpus();
let prevRxBytes = 0;
let prevTxBytes = 0;
let currentRxBytes = 0;
let currentTxBytes = 0;

function updateNetworkBytes() {
  if (process.platform === 'win32') {
    exec('netstat -e', { timeout: 1000 }, (err, stdout) => {
      if (!err && stdout) {
        try {
          const lines = stdout.split('\n');
          for (const line of lines) {
            if (line.toLowerCase().includes('bytes')) {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 3) {
                const rx = parseInt(parts[1], 10);
                const tx = parseInt(parts[2], 10);
                if (!isNaN(rx) && rx > 0) currentRxBytes = rx;
                if (!isNaN(tx) && tx > 0) currentTxBytes = tx;
              }
              break;
            }
          }
        } catch (e) {}
      }
    });
  } else if (process.platform === 'linux') {
    try {
      const fs = require('fs');
      const data = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = data.split('\n');
      let rxSum = 0;
      let txSum = 0;
      for (const line of lines) {
        if (line.includes(':')) {
          const parts = line.split(':');
          if (parts[1]) {
            const stats = parts[1].trim().split(/\s+/);
            rxSum += parseInt(stats[0] || '0', 10);
            txSum += parseInt(stats[8] || '0', 10);
          }
        }
      }
      if (rxSum > 0) currentRxBytes = rxSum;
      if (txSum > 0) currentTxBytes = txSum;
    } catch (e) {}
  }
}

updateNetworkBytes();

let currentTrack = '';
let currentArtist = '';
let currentIsPlaying = false;
let currentVolume = null;
let currentIsMuted = false;
let isMediaSessionQuerying = false;
let mediaSessionQueryPromise = null;
const windowsAudio = createWindowsAudioController();
const windowsMedia = createWindowsMediaController();
const windowsInput = createWindowsInputController({
  clipboard,
  onClipboardChanged: text => { lastClipboardFingerprint = clipboardFingerprint(text); },
  getExcludedWindowHandle: () => {
    if (!mainWindow || mainWindow.isDestroyed()) return '0';
    const handle = mainWindow.getNativeWindowHandle();
    return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
  }
});

function runPowershellEncoded(cmdString) {
  const utf16leBuffer = Buffer.from(cmdString, 'utf16le');
  const base64String = utf16leBuffer.toString('base64');
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${base64String}`;
}
const runPowershellSafely = runPowershellEncoded;

let fastInputHelper = null;

function startFastInputHelper() {
  if (process.platform !== 'win32' || (fastInputHelper && !fastInputHelper.killed)) return fastInputHelper;
  const script = String.raw`
$source = @'
using System;
using System.Runtime.InteropServices;

public static class AetherInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);

  public static void Execute(string input) {
    if (String.IsNullOrWhiteSpace(input)) return;
    string[] parts = input.Trim().Split(' ');
    string command = parts[0].ToUpperInvariant();
    if (command == "MOVE" && parts.Length >= 3) {
      int dx, dy;
      if (!Int32.TryParse(parts[1], out dx) || !Int32.TryParse(parts[2], out dy)) return;
      Point point;
      if (GetCursorPos(out point)) SetCursorPos(point.X + dx, point.Y + dy);
      return;
    }
    if (command == "SCROLL" && parts.Length >= 2) {
      int delta;
      if (Int32.TryParse(parts[1], out delta)) mouse_event(0x0800, 0, 0, delta, UIntPtr.Zero);
      return;
    }
    if (command == "CLICK" && parts.Length >= 2) {
      string button = parts[1].ToLowerInvariant();
      if (button == "right") { mouse_event(0x0008, 0, 0, 0, UIntPtr.Zero); mouse_event(0x0010, 0, 0, 0, UIntPtr.Zero); }
      else if (button == "middle") { mouse_event(0x0020, 0, 0, 0, UIntPtr.Zero); mouse_event(0x0040, 0, 0, 0, UIntPtr.Zero); }
      else { mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); }
    }
  }
}
'@;
Add-Type -TypeDefinition $source;
while (($line = [Console]::In.ReadLine()) -ne $null) {
  try { [AetherInput]::Execute($line) } catch {}
}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  fastInputHelper = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    stdio: ['pipe', 'ignore', 'ignore'],
    windowsHide: true
  });
  fastInputHelper.once('exit', () => { fastInputHelper = null; });
  fastInputHelper.once('error', () => { fastInputHelper = null; });
  return fastInputHelper;
}

function sendFastInput(command) {
  const helper = startFastInputHelper();
  if (!helper || !helper.stdin || helper.stdin.destroyed) return false;
  try {
    helper.stdin.write(`${command}\n`);
    return true;
  } catch (e) {
    try { helper.kill(); } catch (_) {}
    fastInputHelper = null;
    return false;
  }
}

function applyAudioState(state) {
  currentVolume = state.volume;
  currentIsMuted = state.isMuted;
}

function applyDeckAudioState(state) {
  applyAudioState(state);
  aetherDeckService?.publishVariables({
    'audio.volume': currentVolume,
    'audio.muted': currentIsMuted
  });
}

function updateAudioState() {
  if (process.platform !== 'win32') return;
  windowsAudio.getState().then(applyAudioState).catch(() => {});
}

function updateMediaSessionState() {
  if (process.platform === 'win32') {
    if (mediaSessionQueryPromise) return mediaSessionQueryPromise;
    isMediaSessionQuerying = true;
    const psCmd = `
      [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
      try {
        Add-Type -AssemblyName System.Runtime.WindowsRuntime;
        function Await-WinRt($operation, [Type]$resultType) {
          $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1;
          $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation));
          $task.Wait();
          return $task.Result;
        };
        $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime];
        $mgr = Await-WinRt ($managerType::RequestAsync()) $managerType;
        $session = $mgr.GetCurrentSession();
        if ($session) {
          $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime];
          $props = Await-WinRt ($session.TryGetMediaPropertiesAsync()) $propertiesType;
          $playback = $session.GetPlaybackInfo();
          @{
            title = $props.Title;
            artist = $props.Artist;
            isPlaying = ($playback.PlaybackStatus -eq 'Playing' -or $playback.PlaybackStatus -eq 4);
          } | ConvertTo-Json -Compress;
        } else {
          @{ title = ''; artist = ''; isPlaying = $false } | ConvertTo-Json -Compress;
        }
      } catch {}
    `.replace(/\s+/g, ' ').trim();

    const encodedCmd = runPowershellEncoded(psCmd);

    mediaSessionQueryPromise = new Promise(resolve => exec(encodedCmd, { encoding: 'utf8', timeout: 7000 }, (err, stdout) => {
      if (!err && stdout && stdout.trim()) {
        try {
          const info = JSON.parse(stdout.trim());
          currentTrack = info?.title || '';
          currentArtist = info?.artist || '';
          currentIsPlaying = info?.isPlaying === true;
        } catch (_) {}
      }
      isMediaSessionQuerying = false;
      mediaSessionQueryPromise = null;
      resolve({ track: currentTrack, artist: currentArtist, isPlaying: currentIsPlaying });
    }));
    return mediaSessionQueryPromise;
  }
  return Promise.resolve({ track: currentTrack, artist: currentArtist, isPlaying: currentIsPlaying });
}

updateMediaSessionState();
updateAudioState();
setInterval(updateMediaSessionState, 5000);
setInterval(updateAudioState, 5000);



const activeFileTransfers = new Map();
const outgoingRendererTransfers = new Map();
const { createDownloadDirectoryStore, isPathInsideDirectory } = require('./lib/download-directory.cjs');
const downloadDirectoryStore = createDownloadDirectoryStore({
  settingsPath: path.join(app.getPath('userData'), 'download-settings.json'),
  fallbackPath: path.join(os.homedir(), 'Downloads', 'AetherRemote'),
  fs: require('fs')
});

function getMonitorsCount() {
  try {
    const { screen } = require('electron');
    if (screen && screen.getAllDisplays) {
      return screen.getAllDisplays().length || 1;
    }
  } catch (e) {}
  return 1;
}

async function sendScreenFrame(ws, monitorIdx = 0, forceSingleFrame = false) {
  if (!ws || (!forceSingleFrame && !ws.isStreaming) || ws.readyState !== WebSocket.OPEN || ws.isCapturingFrame) return false;
  if (ws.bufferedAmount && ws.bufferedAmount > 512 * 1024) return false;
  
  ws.isCapturingFrame = true;
  let sources = null;
  try {
    const quality = typeof ws.streamQuality === 'number' ? ws.streamQuality : 70;
    const resMode = ws.streamResolution || '720p';
    const targetWidth = resMode === '1080p' ? 1920 : (resMode === '720p' ? 1280 : 854);
    const targetHeight = resMode === '1080p' ? 1080 : (resMode === '720p' ? 720 : 480);

    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: targetWidth, height: targetHeight } });
    if (!sources || sources.length === 0) return false;

    // Electron does not guarantee source ordering.  Keep monitor indexes stable
    // across capture calls so changing a monitor on the client cannot appear to
    // "jump" to another display while the stream is running.
    sources = sources.slice().sort((a, b) => {
      const ad = String(a.display_id || a.id || '');
      const bd = String(b.display_id || b.id || '');
      return ad.localeCompare(bd, undefined, { numeric: true });
    });

    const targetIndex = (monitorIdx >= 0 && monitorIdx < sources.length) ? monitorIdx : 0;
    const targetSource = sources[targetIndex] || sources[0];
    if (!targetSource || !targetSource.thumbnail) return false;

    const jpegBuffer = targetSource.thumbnail.toJPEG(quality);

    if (forceSingleFrame || !ws.lastFrameBuffer?.equals(jpegBuffer)) {
      ws.lastFrameBuffer = jpegBuffer;
      if (ws.readyState === WebSocket.OPEN && (ws.isStreaming || forceSingleFrame)) {
        const packet = Buffer.allocUnsafe(1 + jpegBuffer.length);
        packet[0] = 0x01;
        jpegBuffer.copy(packet, 1);
        const frameMeta = recordFrameDispatch(ws);
        ws.send(JSON.stringify({ action: 'STREAM_FRAME_META', ...frameMeta }));
        ws.send(packet, { binary: true });
        return true;
      }
    }
    return true;
  } catch (err) {
    console.error('[SCREEN] Capture error:', err.message);
    return false;
  } finally {
    sources = null;
    ws.isCapturingFrame = false;
  }
}

function sanitizeFileName(fileName) {
  const baseName = path.basename(String(fileName || 'downloaded_file'));
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  const fallback = cleaned || `downloaded_${Date.now()}`;
  const stem = fallback.split('.')[0].toUpperCase();
  const safeName = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem) ? `_${fallback}` : fallback;
  return safeName.slice(0, 180);
}

function decodeBase64Strict(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  const normalizedInput = value.replace(/=+$/, '');
  return decoded.toString('base64').replace(/=+$/, '') === normalizedInput ? decoded : null;
}

function createUniqueDownloadPath(fileName) {
  return downloadDirectoryStore.createUniquePath(fileName);
}

const incomingFileTransfers = require('./lib/incoming-file-transfers.cjs').createIncomingFileTransfers({
  transfers: activeFileTransfers,
  createPath: fileName => {
    const target = createUniqueDownloadPath(fileName);
    if (!isPathInsideDirectory(target, downloadDirectoryStore.get())) throw new Error('Invalid destination path');
    return target;
  },
  sanitizeName: sanitizeFileName,
  decodeChunk: decodeBase64Strict,
  notify: transfer => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file-received', {
      fileId: transfer.fileId, fileName: transfer.fileName, filePath: transfer.filePath,
      fileSize: transfer.receivedBytes, timestamp: new Date().toLocaleTimeString()
    });
  }
});

function abortFileTransfer(fileId, removePartial = true) {
  return incomingFileTransfers.abort(fileId, removePartial);
}
function updateWsStreamTier(ws, rtt) {
  if (ws.currentTier === undefined) {
    ws.currentTier = 2;
    ws.goodFrameCount = 0;
  }

  if (rtt > 350) {
    if (ws.currentTier > 0) {
      ws.currentTier--;
      ws.goodFrameCount = 0;
      applyTierSettings(ws);
    }
  } else if (rtt < 150) {
    ws.goodFrameCount = (ws.goodFrameCount || 0) + 1;
    if (ws.goodFrameCount >= 5) {
      if (ws.currentTier < 3) {
        ws.currentTier++;
        applyTierSettings(ws);
      }
      ws.goodFrameCount = 0;
    }
  } else {
    ws.goodFrameCount = 0;
  }
}

function applyTierSettings(ws) {
  const TIER_SETTINGS = [
    { quality: 35, resolution: '480p' },
    { quality: 50, resolution: '480p' },
    { quality: 65, resolution: '720p' },
    { quality: 80, resolution: '1080p' }
  ];
  const settings = TIER_SETTINGS[ws.currentTier];
  ws.streamQuality = settings.quality;
  ws.streamResolution = settings.resolution;
  console.log(`[STREAM] RTT adaptation: switched to Tier ${ws.currentTier} (${settings.resolution}, Q: ${settings.quality})`);
}


function updateAudioCaptureState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const enabled = !!(wss && Array.from(wss.clients).some(client =>
    client.readyState === WebSocket.OPEN && client.isAuth && client.isAudioStreaming
  ));
  mainWindow.webContents.send('audio-capture-toggle', { enabled });
}

function broadcastAudioStatus(enabled, status = 'SUCCESS', error = '') {
  if (!wss) return;
  const payload = JSON.stringify({ action: 'AUDIO_STREAM_STATUS', enabled, status, ...(error ? { error } : {}) });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.isAuth && (client.isAudioStreaming || !enabled)) {
      client.send(payload);
    }
  });
}


let bonjourInstance = null;
let bonjourService = null;
let networkChangeMonitor = null;

function startMdnsDiscovery(port) {
  try {
    stopMdnsDiscovery();
    const { Bonjour } = require('bonjour-service');
    bonjourInstance = new Bonjour();
    
    const os = require('os');
    const hostname = os.hostname();
    
    bonjourService = bonjourInstance.publish({
      name: `Aether Remote Host - ${hostname}`,
      type: 'aether-remote',
      protocol: 'tcp',
      port: port,
      txt: {
        version: app.getVersion(),
        hostname: hostname,
        ip: LOCAL_IP,
        mac: LOCAL_MAC,
        protocolVersion: '2.0',
        secure: 'true',
        tlsFingerprint
      }
    });
    
    console.log(`[mDNS] Service advertised: Aether Remote Host - ${hostname} on port ${port}`);
  } catch (err) {
    console.log(`[mDNS] Discovery not available or failed to start: ${err.message}`);
  }
}

function stopMdnsDiscovery() {
  if (bonjourService) {
    try {
      bonjourService.stop();
      console.log('[mDNS] Service advertisement stopped.');
    } catch (e) {}
    bonjourService = null;
  }
  if (bonjourInstance) {
    try {
      bonjourInstance.destroy();
    } catch (e) {}
    bonjourInstance = null;
  }
}


function getRealCpuPercent() {
  const currentCpus = os.cpus();
  let totalDiff = 0;
  let idleDiff = 0;

  for (let i = 0; i < currentCpus.length; i++) {
    const prev = prevCpus[i] ? prevCpus[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const curr = currentCpus[i].times;

    const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
    const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;

    totalDiff += (currTotal - prevTotal);
    idleDiff += (curr.idle - prev.idle);
  }

  prevCpus = currentCpus;
  if (totalDiff <= 0) return 12.0;

  const pct = ((totalDiff - idleDiff) / totalDiff) * 100;
  return parseFloat(Math.min(100, Math.max(0, pct)).toFixed(1));
}

function getRealRamMetrics() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const ramPct = parseFloat(((used / total) * 100).toFixed(1));
  const usedGb = parseFloat((used / (1024 * 1024 * 1024)).toFixed(1));
  const totalGb = parseFloat((total / (1024 * 1024 * 1024)).toFixed(1));
  return { ramPct, usedGb, totalGb };
}


function getAuthenticatedWssCount() {
  if (!wss) return 0;
  let count = 0;
  wss.clients.forEach(c => {
    if (c.readyState === 1 && c.isAuth) {
      count++;
    }
  });
  return count;
}

function getConnectedDevicesCount() {
  return getAuthenticatedWssCount();
}

function isAnyScreenStreamActive() {
  if (!wss) return false;
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.isAuth && client.isStreaming) return true;
  }
  return false;
}

function startTelemetryBroadcaster(mainWindow) {
  setInterval(() => {
    const cpu = getRealCpuPercent();
    const { ramPct, usedGb, totalGb } = getRealRamMetrics();

    let net_download = 0.0;
    let net_upload = 0.0;

    if (prevRxBytes > 0 && currentRxBytes >= prevRxBytes) {
      net_download = parseFloat(((currentRxBytes - prevRxBytes) / (1024 * 1024 * 1.5)).toFixed(2));
    }
    if (prevTxBytes > 0 && currentTxBytes >= prevTxBytes) {
      net_upload = parseFloat(((currentTxBytes - prevTxBytes) / (1024 * 1024 * 1.5)).toFixed(2));
    }

    prevRxBytes = currentRxBytes;
    prevTxBytes = currentTxBytes;
    updateNetworkBytes();

    const telemetryData = {
      cpu: cpu,
      ram: ramPct,
      ramUsedGb: usedGb,
      ramTotalGb: totalGb,
      net_upload: net_upload,
      net_download: net_download,
      hostname: os.hostname(),
      uptime: Math.floor(os.uptime()),
      track: currentTrack,
      artist: currentArtist,
      isPlaying: currentIsPlaying,
      volume: currentVolume,
      isMuted: currentIsMuted,
      isScreenStreaming: isAnyScreenStreamActive(),
      monitorsCount: getMonitorsCount(),
      connectedClients: getConnectedDevicesCount()
    };

    aetherDeckService?.publishVariables({
      'system.cpu': telemetryData.cpu,
      'system.ram': telemetryData.ram,
      'system.hostname': telemetryData.hostname,
      'system.connectedClients': telemetryData.connectedClients,
      'audio.volume': telemetryData.volume,
      'audio.muted': telemetryData.isMuted,
      'media.track': telemetryData.track,
      'media.artist': telemetryData.artist,
      'media.playing': telemetryData.isPlaying,
      'stream.screen': telemetryData.isScreenStreaming
    });

    if (wss) {
      const payload = JSON.stringify({
        action: 'TELEMETRY',
        data: telemetryData
      });
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.isAuth) {
          client.send(payload);
        }
      });
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('telemetry-update', telemetryData);
    }
  }, 1500);
}

function ensureFirewallRule() {
  if (process.platform === 'win32') {
    try {
      const allowedRemoteRanges = 'localsubnet,100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16';
      const checkCmd = 'netsh advfirewall firewall show rule name="AetherHost"';
      exec(checkCmd, (err, stdout) => {
        if (err || stdout.includes('No rules match')) {
          const addCmd = `netsh advfirewall firewall add rule name="AetherHost" dir=in action=allow protocol=TCP localport=${PORT} profile=any remoteip=${allowedRemoteRanges}`;
          exec(addCmd, (addErr) => {
            if (!addErr) console.log(`[FIREWALL] Inbound rule created for TCP ${PORT}`);
          });
        } else {
          const restrictCmd = `netsh advfirewall firewall set rule name="AetherHost" new profile=any remoteip=${allowedRemoteRanges}`;
          exec(restrictCmd, (updateError) => {
            if (updateError) console.warn('[FIREWALL] Existing rule could not be updated for LAN and VPN ranges.');
          });
        }
      });
    } catch (e) {
      console.error('[FIREWALL] Setup skipped:', e.message);
    }
  }
}

const CRITICAL_PROCESSES = [
  'csrss', 'explorer', 'lsass', 'smss', 'services', 'winlogon', 'svchost', 'system', 'conhost', 'init'
];


function executeSystemCommand(action, data) {
  return new Promise((resolve) => {
    const command = data.command || '';
    const text = data.text || '';
    const process_name = data.process_name || '';
    const process_field = data.process || '';

    if (action === 'KILL_PROCESS') {
      const proc = (process_field || process_name || command || '').trim();
      const cleanProc = proc.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!cleanProc) {
        resolve({ status: 'ERROR', message: 'Invalid process name or PID' });
        return;
      }

      const nameLower = cleanProc.toLowerCase().replace(/\.exe$/i, '');
      if (CRITICAL_PROCESSES.includes(nameLower)) {
        resolve({ status: 'ERROR', message: `Cannot terminate critical Windows process '${cleanProc}'` });
        return;
      }

      if (process.platform === 'win32') {
        const isPid = /^\d+$/.test(cleanProc);
        const args = isPid ? ['/PID', cleanProc, '/F'] : ['/IM', `${nameLower}.exe`, '/F'];
        execFile('taskkill.exe', args, { timeout: 10000, windowsHide: true }, (err) => {
          const msg = err ? 'Failed to terminate process' : `Successfully terminated process ${cleanProc}`;
          resolve({ status: err ? 'ERROR' : 'SUCCESS', output: msg });
        });
      } else {
        execFile('killall', [cleanProc], { timeout: 10000 }, (err) => {
          const msg = err ? 'Failed to terminate process' : `Successfully terminated process ${cleanProc}`;
          resolve({ status: err ? 'ERROR' : 'SUCCESS', output: msg });
        });
      }
    }
    else if (action === 'MOUSE_MOVE' || action === 'REMOTE_MOUSE_MOVE') {
      const dx = Math.max(-5000, Math.min(5000, parseInt(data.dx || 0, 10) || 0));
      const dy = Math.max(-5000, Math.min(5000, parseInt(data.dy || 0, 10) || 0));
      if (process.platform === 'win32') {
        sendFastInput(`MOVE ${dx} ${dy}`);
      }
      resolve({ status: 'SUCCESS', action: 'MOUSE_MOVED', dx, dy });
    }
    else if (action === 'MOUSE_CLICK' || action === 'REMOTE_MOUSE_CLICK') {
      const button = (data.button || 'left').toLowerCase();
      if (!['left', 'right', 'middle'].includes(button)) {
        resolve({ status: 'ERROR', message: 'Invalid mouse button' });
        return;
      }
      if (process.platform === 'win32') {
        sendFastInput(`CLICK ${button}`);
      }
      resolve({ status: 'SUCCESS', action: 'MOUSE_CLICKED', button });
    }
    else if (action === 'MOUSE_SCROLL' || action === 'REMOTE_MOUSE_SCROLL') {
      const delta = Math.max(-100, Math.min(100, parseInt(data.delta || 0, 10) || 0)) * 120;
      if (process.platform === 'win32') {
        sendFastInput(`SCROLL ${delta}`);
      }
      resolve({ status: 'SUCCESS', action: 'MOUSE_SCROLLED', delta });
    }
    else if (action === 'KEY_PRESS' || action === 'REMOTE_KEY_PRESS') {
      const key = String(data.key || text || '').trim().slice(0, 64);
      if (key && process.platform === 'win32') {
        const escapedKey = key.replace(/[{}+^%~()\[\]]/g, '{$&}').replace(/'/g, "''");
        const psCmd = `$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${escapedKey}')`;
        exec(runPowershellEncoded(psCmd));
      }
      resolve({ status: 'SUCCESS', action: 'KEY_PRESSED', key });
    }
    else if (action === 'SEND_TOAST') {
      const title = data.title || 'Aether Remote';
      const message = text || command || '';
      if (Notification.isSupported()) {
        new Notification({ title, body: message }).show();
      }

      resolve({ status: 'SUCCESS', message: 'TOAST_SENT' });
    }
    else if (action === 'POWER') {
      const pCmd = (command || '').toUpperCase();
      const allowedPowerCommands = new Set(['LOCK', 'SLEEP', 'SHUTDOWN', 'REBOOT', 'ALT_F4', 'CLOSE_WINDOW']);
      if (!allowedPowerCommands.has(pCmd)) {
        resolve({ status: 'ERROR', message: 'Unknown power command' });
        return;
      }
      if (process.platform === 'win32') {
        let psPowerCmd = '';
        if (pCmd === 'LOCK') {
          psPowerCmd = 'rundll32.exe user32.dll,LockWorkStation';
        } else if (pCmd === 'SLEEP') {
          psPowerCmd = 'Add-Type -Assembly System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false)';
        } else if (pCmd === 'SHUTDOWN') {
          psPowerCmd = 'Stop-Computer -Force';
        } else if (pCmd === 'REBOOT') {
          psPowerCmd = 'Restart-Computer -Force';
        } else if (pCmd === 'ALT_F4' || pCmd === 'CLOSE_WINDOW') {
          psPowerCmd = '$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys("%{F4}")';
        }

        const fullCmd = runPowershellEncoded(psPowerCmd);
        exec(fullCmd, { timeout: 10000 }, (error) => {
          resolve(error
            ? { status: 'ERROR', error: 'Power command failed', command: pCmd }
            : { status: 'POWER_EXECUTED', command: pCmd });
        });
        return;
      }
      resolve({ status: 'ERROR', error: 'Power controls are only supported on Windows' });
    }
    else if (action === 'MEDIA') {
      const cmd = (command || '').toUpperCase();
      const allowedMediaCommands = new Set(['VOL_SET', 'VOLUME_SET', 'VOL_UP', 'VOL_DOWN', 'VOL_MUTE', 'NEXT_TRACK', 'PREV_TRACK', 'PLAY_PAUSE']);
      if (!allowedMediaCommands.has(cmd)) {
        resolve({ status: 'ERROR', message: 'Unknown media command' });
        return;
      }
      if (process.platform === 'win32') {
        const rawInput = data.val !== undefined ? data.val : data.value;
        const parsedVal = rawInput === undefined || rawInput === null || rawInput === '' ? NaN : Number(rawInput);
        const val = Number.isFinite(parsedVal) ? Math.max(0, Math.min(100, Math.round(parsedVal))) : null;
        
        const volumeOperation = (cmd === 'VOL_SET' || cmd === 'VOLUME_SET') ? 'SET'
          : cmd === 'VOL_UP' ? 'UP'
          : cmd === 'VOL_DOWN' ? 'DOWN'
          : cmd === 'VOL_MUTE' ? 'MUTE'
          : null;
        if (volumeOperation) {
          if (volumeOperation === 'SET' && val === null) {
            resolve({ status: 'ERROR', error: 'Invalid volume value' });
            return;
          }
          const amount = volumeOperation === 'SET'
            ? val
            : Math.max(1, Math.min(20, Number(data.val ?? data.value ?? 5) || 5));
          const operation = volumeOperation === 'SET' ? windowsAudio.setVolume(amount)
            : volumeOperation === 'UP' ? windowsAudio.stepUp(amount)
            : volumeOperation === 'DOWN' ? windowsAudio.stepDown(amount)
            : windowsAudio.toggleMute();
          operation.then(state => {
            applyAudioState(state);
            resolve({ status: 'MEDIA_EXECUTED', command: cmd, volume: currentVolume, isMuted: currentIsMuted, isPlaying: currentIsPlaying });
          }).catch(error => {
            console.error('[MEDIA] Audio control failed:', error.message);
            resolve({ status: 'ERROR', error: 'Audio control failed', command: cmd });
          });
          return;
        }

        if (cmd === 'PLAY_PAUSE') {
          windowsMedia.togglePlayPause().then(async () => {
            await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
            await updateMediaSessionState();
            resolve({ status: 'MEDIA_EXECUTED', command: cmd, volume: currentVolume, isMuted: currentIsMuted, isPlaying: currentIsPlaying });
          }).catch(error => {
            console.error('[MEDIA] Playback control failed:', error.message);
            resolve({ status: 'ERROR', error: 'Playback control failed', command: cmd });
          });
          return;
        }

        let vkey = '';
        if (cmd === 'NEXT_TRACK') vkey = '[char]176';
        else if (cmd === 'PREV_TRACK') vkey = '[char]177';
        const mediaCommand = vkey
          ? runPowershellEncoded(`$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys(${vkey})`)
          : '';
        if (!mediaCommand) {
          resolve({ status: 'ERROR', error: 'Invalid media command parameters' });
          return;
        }
        exec(mediaCommand, { timeout: 10000 }, (error) => {
          if (!error) {
            setTimeout(updateMediaSessionState, 250);
          }
          resolve(error
            ? { status: 'ERROR', error: 'Media command failed', command: cmd }
            : { status: 'MEDIA_EXECUTED', command: cmd, volume: currentVolume, isMuted: currentIsMuted, isPlaying: currentIsPlaying });
        });
        return;
      }
      resolve({ status: 'ERROR', error: 'Media controls are only supported on Windows' });
    }
    else if (action === 'CLIPBOARD' || action === 'WRITE_CLIPBOARD' || (action === 'SYSTEM' && (command === 'READ_CLIPBOARD' || command === 'WRITE_CLIPBOARD'))) {
      const isGet = (command === 'GET' || command === 'GET_CLIPBOARD' || text === 'GET' || action === 'GET_CLIPBOARD' || command === 'READ_CLIPBOARD');
      if (isGet) {
        const textVal = windowsInput.readClipboardText();
        resolve({ action: 'CLIPBOARD_TEXT', text: textVal });
      } else {
      const textToWrite = clipboardWriteText(data);
        if (windowsInput.isClipboardBusy()) {
          resolve({ status: 'ERROR', error: 'Clipboard is busy; retry after text input' });
          return;
        }
        windowsInput.writeClipboardText(textToWrite);
        lastClipboardFingerprint = clipboardFingerprint(textToWrite);
        resolve({ action: 'CLIPBOARD_WRITE_ACK', status: 'CLIPBOARD_WRITTEN', text: textToWrite });
      }
    } else {
      resolve({ status: 'ERROR', error: `Unknown command action: ${String(action || '')}` });
    }
  });
}

setInterval(() => {
  const now = Date.now();
  const fs = require('fs');
  for (const [fileId, transfer] of activeFileTransfers.entries()) {
    const timeoutMs = incomingTransferTimeoutMs(transfer);
    if (now - transfer.lastActivity > timeoutMs) {
      console.warn(`[FILE] Transfer ${fileId} timed out due to inactivity. Cleaning up.`);
      if (transfer.ws?.readyState === WebSocket.OPEN) transfer.ws.send(JSON.stringify({ action: 'FILE_CANCEL', fileId, error: 'Transfer timed out due to inactivity' }));
      abortFileTransfer(fileId, true);
    }
  }
  for (const [fileId, transfer] of outgoingRendererTransfers.entries()) {
    if (now - transfer.lastActivity > OUTGOING_TRANSFER_TIMEOUT_MS) {
      if (transfer.pendingAck) transfer.pendingAck.reject(new Error('Outgoing file transfer timed out'));
      transfer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuth) client.send(JSON.stringify({ action: 'FILE_CANCEL', fileId }));
      });
      outgoingRendererTransfers.delete(fileId);
    }
  }
}, 15000);

let wss = null;
let controlServer = null;
let acceptAccountRelayStream = null;
const CLIPBOARD_HISTORY_MAX_CHARS = 100_000;
let lastClipboardFingerprint = '';
const clipboardSettingsPath = path.join(app.getPath('userData'), 'clipboard-settings.json');
let clipboardSharingEnabled = false;
try {
  clipboardSharingEnabled = JSON.parse(require('fs').readFileSync(clipboardSettingsPath, 'utf8')).enabled === true;
} catch (_) {}
function clipboardSharingStatus() {
  const recipients = clipboardSharingEnabled && wss
    ? [...wss.clients].filter(client => client.readyState === WebSocket.OPEN && client.isAuth && client.capabilities?.has('clipboard-history-v1')).length : 0;
  return { enabled: clipboardSharingEnabled, recipients };
}


function clipboardFingerprint(text) {
  return text.length <= CLIPBOARD_HISTORY_MAX_CHARS
    ? text
    : `${text.length}:${text.slice(0, 256)}:${text.slice(-256)}`;
}

setInterval(() => {
  if (!wss || !clipboardSharingEnabled || windowsInput.isClipboardBusy()) return;
  const clipboardText = clipboard.readText();
  const fingerprint = clipboardFingerprint(clipboardText);
  if (fingerprint === lastClipboardFingerprint) return;
  lastClipboardFingerprint = fingerprint;
  if (clipboardText.length > CLIPBOARD_HISTORY_MAX_CHARS) return;
  const text = clipboardText.trim();
  if (!text) return;
  const message = JSON.stringify({ action: 'CLIPBOARD_ITEM', text, source: 'pc', createdAt: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.isAuth && client.capabilities?.has('clipboard-history-v1')) {
      client.send(message);
    }
  }
}, 1500);
const aetherDeckClients = new Set();
let aetherDeckStore = null;
let aetherDeckService = null;
let aetherDeckAssetStore = null;
let aetherDeckRegistry = null;
let aetherDeckObsClient = null;
let aetherDeckForegroundObserver = null;
let aetherDeckProviderUnsubscribe = null;
let aetherDeckObsSettings = { url: 'ws://127.0.0.1:4455', password: '' };
let wakeHostService = null;
let wakeHostStatus = { status: 'unconfigured', bridgeEnabled: false, members: [], targets: [] };

async function initializeWakeBridge() {
  const relayUrl = String(process.env.AETHER_WAKE_RELAY_URL || '').trim();
  if (!relayUrl) return;
  const wakeDirectory = path.join(app.getPath('userData'), 'Wake Bridge');
  const identityStore = createWakeIdentityStore({ filePath: path.join(wakeDirectory, 'identity.dat'), safeStorage });
  const nonceExpiries = new Map();
  wakeHostService = createWakeHostService({
    identityStore,
    groupStoreFactory: identity => createWakeGroupStore({ filePath: path.join(wakeDirectory, 'group.dat'), safeStorage, ownerIdentity: identity }),
    enrollmentFactory: options => createWakeEnrollment(options),
    relayApiFactory: identity => createWakeRelayApi({ identity }),
    bridgeFactory: ({ group, groupStore }) => createWakeBridge({
      enabled: () => groupStore.load().group?.bridgeEnabled === true,
      groupId: group.groupId,
      memberStore: { getPublicKey: deviceId => groupStore.getMemberPublicKey(deviceId) },
      targetStore: { get: deviceId => groupStore.getTarget(deviceId) },
      udpSender: mac => sendWakeMagicPacket({ mac, targets: collectBroadcastTargets(os.networkInterfaces()) }),
      nonceStore: {
        has: nonce => (nonceExpiries.get(nonce) || 0) >= Date.now(),
        add: (nonce, expiresAt) => {
          for (const [stored, expiry] of nonceExpiries) if (expiry < Date.now()) nonceExpiries.delete(stored);
          nonceExpiries.set(nonce, expiresAt);
        }
      }
    }),
    relayClientFactory: options => createWakeRelayClient({ WebSocketImpl: WebSocket, ...options }),
    relayUrl,
    host: { name: os.hostname(), mac: LOCAL_MAC },
    onState: state => {
      wakeHostStatus = state;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('wake-bridge-status', state);
    }
  });
  const result = await wakeHostService.start();
  if (!result.ok) wakeHostStatus = { ...wakeHostStatus, status: 'error', detail: result.code };
}

function setDeckScreenStreaming(enabled, context = {}) {
  const client = context.client;
  if (!client || client.readyState !== WebSocket.OPEN || client.isAuth !== true) throw new Error('Подключённый телефон недоступен');
  client.isStreaming = enabled === true;
  client.monitorIndex = Number.isInteger(client.monitorIndex) ? client.monitorIndex : 0;
  if (client.isStreaming) {
    if (!client.frameInterval) client.frameInterval = setInterval(() => sendScreenFrame(client, client.monitorIndex), 100);
    sendScreenFrame(client, client.monitorIndex);
  } else if (client.frameInterval) {
    clearInterval(client.frameInterval);
    client.frameInterval = null;
  }
  aetherDeckService?.publishVariables({ 'stream.screen': client.isStreaming });
  return { status: 'success', enabled: client.isStreaming };
}

function loadAetherDeckObsSettings(directory) {
  const settingsPath = path.join(directory, 'obs-settings.json');
  try {
    const raw = JSON.parse(require('fs').readFileSync(settingsPath, 'utf8'));
    const url = typeof raw.url === 'string' && validateObsWebSocketUrl(raw.url) ? raw.url : 'ws://127.0.0.1:4455';
    let password = '';
    if (raw.password && safeStorage.isEncryptionAvailable()) password = safeStorage.decryptString(Buffer.from(raw.password, 'base64'));
    else if (raw.password) console.warn('[AETHER DECK] OBS password is present but secure storage is unavailable; it was not loaded.');
    return { url, password };
  } catch (_) {
    return { url: 'ws://127.0.0.1:4455', password: '' };
  }
}

function saveAetherDeckObsSettings(directory, settings) {
  const fs = require('fs');
  fs.mkdirSync(directory, { recursive: true });
  if (settings.password && !safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable; the OBS password was not saved');
  }
  if (!validateObsWebSocketUrl(settings.url)) throw new Error('OBS URL must point to a private or loopback ws/wss address');
  const password = settings.password ? safeStorage.encryptString(settings.password).toString('base64') : '';
  fs.writeFileSync(path.join(directory, 'obs-settings.json'), JSON.stringify({ url: settings.url, password }, null, 2), 'utf8');
}

async function initializeAetherDeck() {
  aetherDeckProviderUnsubscribe?.();
  aetherDeckProviderUnsubscribe = null;
  aetherDeckForegroundObserver?.stop();
  aetherDeckForegroundObserver = null;
  aetherDeckObsClient?.disconnect();
  const directory = path.join(app.getPath('userData'), 'Aether Deck');
  aetherDeckStore = createDeckStore({ directory });
  await aetherDeckStore.load();
  aetherDeckAssetStore = createDeckAssetStore({ directory: path.join(directory, 'assets') });
  await aetherDeckAssetStore.prune(aetherDeckStore.getSnapshot());
  aetherDeckRegistry = createProviderRegistry();
  aetherDeckRegistry.register(createAetherProvider({ executeSystemCommand, setScreenStreaming: setDeckScreenStreaming, windowsAudio, onAudioState: applyDeckAudioState }));
  aetherDeckRegistry.register(createSystemProvider({
    shell,
    windowsInput,
    authorizeDangerousAction: async (action, context) => {
      const description = `Aether Deck program: ${String(action.parameters?.path || '').slice(0, 160)}`;
      const approval = await requestHostApproval(mainWindow, context.client?.clientIp || 'Aether Deck', description, 'command');
      return approval.approved === true;
    }
  }));
  aetherDeckRegistry.register(createInputProvider({ windowsInput }));
  aetherDeckRegistry.register(createAudioProvider({ windowsAudio, onAudioState: applyDeckAudioState }));
  aetherDeckRegistry.register(createNavigationProvider());
  aetherDeckObsSettings = loadAetherDeckObsSettings(directory);
  aetherDeckObsClient = createObsClient({ WebSocketImpl: WebSocket, url: aetherDeckObsSettings.url, password: aetherDeckObsSettings.password });
  aetherDeckRegistry.register(createObsProvider({ client: aetherDeckObsClient }));
  let serviceReference = null;
  const engine = createMacroEngine({
    registry: aetherDeckRegistry,
    publishState: (controlId, state) => serviceReference?.publishControlState(controlId, state)
  });
  serviceReference = createAetherDeckService({ store: aetherDeckStore, engine, registry: aetherDeckRegistry, clients: aetherDeckClients, assetStore: aetherDeckAssetStore });
  aetherDeckService = serviceReference;
  aetherDeckProviderUnsubscribe = aetherDeckRegistry.subscribe(patch => aetherDeckService.publishVariables(patch));
  aetherDeckForegroundObserver = createForegroundAppObserver({
    publish: application => aetherDeckService.handleForegroundApp(application),
    shouldObserve: () => aetherDeckStore.getSnapshot().decks.some(deck => deck.enabled !== false && deck.autoSwitchEnabled === true && deck.applicationRules.length > 0)
  });
  aetherDeckForegroundObserver.start();
  if (aetherDeckObsSettings.password || aetherDeckObsSettings.url !== 'ws://127.0.0.1:4455') {
    aetherDeckObsClient.connect().catch(() => {});
  }
}

async function startStaticServer(mainWindow) {
  try {
    const identity = await loadOrCreateTlsIdentity(path.join(app.getPath('userData'), 'tls'), [LOCAL_IP]);
    tlsFingerprint = identity.fingerprint;
    void accountHostService?.refresh().catch(() => {});
    const server = https.createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.2' }, (req, res) => {
      const isHealth = req.method === 'GET' && req.url === '/health';
      const isKnownPath = req.url === '/health';
      const status = isHealth ? 200 : isKnownPath ? 405 : 404;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
      });
      res.end(JSON.stringify(isHealth
        ? { status: 'ok', protocolVersion: '2.0', port: PORT, secure: true, tlsFingerprint }
        : { error: status === 405 ? 'Method not allowed' : 'Not found' }));
    });
    controlServer = server;
    acceptAccountRelayStream = (stream, sessionId) => {
      require('./lib/account/relay-tls-server.cjs').acceptRelayTlsStream(stream, sessionId, identity,
        (socket, request) => wss.emit('connection', socket, request));
    };

    wss = new WebSocket.Server({ server, maxPayload: 1024 * 1024 });

    wss.on('connection', (ws, req) => {
      const admission = connectionAdmission(wss.clients);
      if (!admission.totalAllowed || !admission.preauthAllowed) {
        ws.close(1013, 'Connection limit reached');
        return;
      }
      const relayMatch = /^\/account-relay\/([0-9a-f-]{36})$/.exec(req.url || '');
      if ((relayMatch && req.aetherRelaySessionId !== relayMatch[1]) ||
          (req.url !== '/' && (!relayMatch || !accountHostService?.relay?.matches(relayMatch[1])))) {
        ws.close(1008, 'Unsupported WebSocket endpoint');
        return;
      }
      ws.accountTransport = relayMatch ? 'relay' : 'lan';
      ws.relaySessionId = relayMatch?.[1];
      ws.accountAuthentication = !!relayMatch;
      aetherDeckClients.add(ws);
      ws.isAuth = false;
      ws.isStreaming = false;
      ws.streamQuality = 70;
      ws.streamResolution = '720p';
      ws.frameInterval = null;
      ws.lastFrameBuffer = null;
      ws.isCapturingFrame = false;
      ws.authDeadline = setTimeout(() => {
        if (ws.isAuth !== true && ws.readyState === WebSocket.OPEN) ws.close(1008, 'Authentication timeout');
      }, PREAUTH_TIMEOUT_MS);
      ws.authDeadline.unref?.();

      const clientIp = req.socket.remoteAddress || 'unknown';
      ws.clientIp = clientIp;

      const origin = req.headers.origin || req.headers['sec-websocket-origin'];
      if (origin && typeof origin === 'string') {
        const lowerOrigin = origin.toLowerCase();
        let isAllowed = false;
        try {
          const parsed = new URL(lowerOrigin);
          const host = parsed.hostname;
          isAllowed = ['http:', 'https:'].includes(parsed.protocol) && isPrivateLanHostname(host);
        } catch (e) {
          isAllowed = false;
        }

        if (!isAllowed) {
          console.warn('[SECURITY] CSWSH attempt blocked from an untrusted origin.');
          clearTimeout(ws.authDeadline);
          ws.authDeadline = null;
          aetherDeckClients.delete(ws);
          ws.send(JSON.stringify({ status: 'AUTH_BLOCKED', error: 'Untrusted web origin' }));
          ws.close(1008, 'Forbidden CSWSH Origin');
          return;
        }
      }

      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          const validation = validateInboundMessage(data);
          if (!validation.ok) {
            ws.send(JSON.stringify({ status: 'ERROR', error: validation.error }));
            return;
          }
          const action = data.action;

          if (action.startsWith('ACCOUNT_')) {
            ws.accountAuthentication = true;
            if (!accountHostService) {
              ws.send(JSON.stringify({ status: 'AUTH_REJECTED', error: 'Аккаунт недоступен на этом ПК.' }));
              ws.close(1008, 'Account unavailable');
              return;
            }
            ws.capabilities = new Set(Array.isArray(data.capabilities) ? data.capabilities : [...(ws.capabilities || [])]);
            await accountHostService.handle(ws, data, grant => {
              ws.isAuth = true;
              clearTimeout(ws.authDeadline);
              ws.authDeadline = null;
              ws.accountGrant = grant;
              ws.send(JSON.stringify({ status: 'AUTH_OK', authMode: 'account', grant,
                hostPublicKeySpki: accountHostService.identity.publicKeySpki,
                capabilities: ['file-transfer-v2', 'binary-screen-v1', 'binary-audio-pcm16-v1', 'aether-deck-v1', 'clipboard-history-v1'],
                trusted: true, connectedClients: getConnectedDevicesCount(), host: os.hostname(), mac: LOCAL_MAC,
                platform: process.platform, protocolVersion: '2.0', tlsFingerprint }));
              if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('client-authenticated', { ip: clientIp });
            });
            return;
          }
          if (action === 'AUTH') {
            if (ws.accountAuthentication) { ws.close(1008, 'Authentication mode cannot change'); return; }
            if (ws.authInProgress) {
              ws.send(JSON.stringify({ status: 'AUTH_PENDING', requestId: ws.pendingPairingRequestId || '' }));
              return;
            }
            const enteredPin = (data.pin || '').toString();
            const passedToken = data.sessionToken || '';
            ws.capabilities = new Set(Array.isArray(data.capabilities) ? data.capabilities.map(String).slice(0, 32) : []);
            
            const authAttempt = handleAuthAttempt(clientIp, enteredPin, passedToken);

            if (authAttempt.success) {
              const approvalPolicy = decideApproval({ credentialValid: true, tokenTrusted: authAttempt.trusted });
              let approval = { approved: true, trusted: true };
              if (approvalPolicy === 'prompt') {
                ws.authInProgress = true;
                approval = await requestHostApproval(
                  mainWindow,
                  clientIp,
                  String(data.deviceModel || 'Aether mobile client').slice(0, 80),
                  'pairing',
                  requestId => {
                    ws.pendingPairingRequestId = requestId;
                    ws.send(JSON.stringify({ status: 'AUTH_PENDING', requestId }));
                  }
                );
                ws.authInProgress = false;
                ws.pendingPairingRequestId = null;
              }

              if (ws.readyState !== WebSocket.OPEN) return;
              if (!approval.approved) {
                ws.send(JSON.stringify({ status: 'AUTH_REJECTED', error: 'Connection rejected on PC' }), () => {
                  ws.close(1008, 'Connection rejected on PC');
                });
                return;
              }

              const now = Date.now();
              const existingTokenInfo = authenticatedTokens.get(authAttempt.token);
              const tokenInfo = normalizeTokenInfo({
                ...existingTokenInfo,
                lastUsedAt: now,
                issuedAt: existingTokenInfo?.issuedAt || now,
                expiresAt: existingTokenInfo?.expiresAt || now + TOKEN_TTL_MS,
                trusted: authAttempt.trusted === true || approval.trusted === true,
                deviceName: String(data.deviceModel || 'Aether mobile client').slice(0, 80),
                ipAddress: String(clientIp).slice(0, 80)
              }, now, TOKEN_TTL_MS);
              if (authAttempt.isNewToken || approval.trusted === true || !existingTokenInfo) {
                authenticatedTokens.set(authAttempt.token, tokenInfo);
                savePersistedTokens();
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send('tokens-updated', getTrustedTokenViews(now));
                }
              }
              ws.isAuth = true;
              ws.sessionToken = authAttempt.token;
              clearTimeout(ws.authDeadline);
              ws.authDeadline = null;
              ws.cancelSessionExpiry?.();
              ws.cancelSessionExpiry = scheduleAbsoluteExpiry(tokenInfo.expiresAt, () => {
                if (ws.readyState === WebSocket.OPEN) ws.close(1008, 'Session token expired');
              });
              ws.send(JSON.stringify({ 
                status: 'AUTH_OK', 
                sessionToken: authAttempt.token,
                capabilities: ['file-transfer-v2', 'binary-screen-v1', 'binary-audio-pcm16-v1', 'aether-deck-v1', 'clipboard-history-v1'],
                trusted: tokenInfo.trusted,
                connectedClients: getConnectedDevicesCount(),
                host: os.hostname(),
                mac: LOCAL_MAC,
                platform: process.platform,
                wakeTargetDeviceId: wakeHostStatus.targets?.[0]?.deviceId || '',
                wakeBridgeAvailable: wakeHostStatus.status !== 'unconfigured' && wakeHostStatus.status !== 'error',
                protocolVersion: '2.0',
                tlsFingerprint
              }));
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('client-authenticated', { ip: clientIp });
              }
            } else {
              if (authAttempt.isBlocked) {
                ws.send(JSON.stringify({ 
                  status: 'AUTH_BLOCKED', 
                  error: authAttempt.reason,
                  remainingAttempts: authAttempt.remainingAttempts,
                  cooldown: authAttempt.cooldown
                }));
                ws.close(1008, 'Brute force blocked');
              } else {
                ws.send(JSON.stringify({
                  status: 'AUTH_FAILED',
                  error: authAttempt.reason,
                  remainingAttempts: authAttempt.remainingAttempts
                }));
              }
            }
            return;
          }

          if (!ws.isAuth) {
            ws.send(JSON.stringify({ status: 'AUTH_REQUIRED', error: 'Please authenticate first.' }));
            return;
          }
          if (!isGuestSessionActive(ws, authenticatedTokens)) {
            ws.isAuth = false;
            ws.send(JSON.stringify({ status: 'AUTH_REQUIRED', error: 'Session token has expired.' }));
            ws.close(1008, 'Session token expired');
            return;
          }

          if (action === 'WAKE_ENROLL') {
            if (!wakeHostService) {
              ws.send(JSON.stringify({ status: 'WAKE_ENROLL_ERROR', error: 'wake_bridge_unconfigured' }));
              return;
            }
            const tokenInfo = authenticatedTokens.get(ws.sessionToken);
            if (!tokenInfo || tokenInfo.trusted !== true) {
              ws.send(JSON.stringify({ status: 'WAKE_ENROLL_ERROR', error: 'trusted_session_required' }));
              return;
            }
            const result = await wakeHostService.approvePhone({
              deviceId: String(data.deviceId || ''),
              publicKeySpki: String(data.publicKeySpki || '')
            });
            if (result.ok) {
              tokenInfo.wakeDeviceId = String(data.deviceId || '');
              authenticatedTokens.set(ws.sessionToken, tokenInfo);
              savePersistedTokens();
            }
            ws.send(JSON.stringify(result.ok
              ? { status: 'WAKE_ENROLL_OK', ...result }
              : { status: 'WAKE_ENROLL_ERROR', error: result.code || 'enrollment_failed' }));
            return;
          }

          if (aetherDeckService && typeof action === 'string' && action.startsWith('DECK_')) {
            if (await aetherDeckService.handleMessage(ws, data)) return;
          }

          if (action === 'PING') {
            ws.send(JSON.stringify({
              action: 'PONG',
              timestamp: Number.isFinite(Number(data.timestamp)) ? Number(data.timestamp) : Date.now()
            }));
          }
          else if (action === 'GET_TELEMETRY') {
            if (process.platform === 'win32') {
              try {
                applyAudioState(await windowsAudio.getState());
              } catch (_) {}
            }
            const cpu = getRealCpuPercent();
            const { ramPct, usedGb, totalGb } = getRealRamMetrics();
            ws.send(JSON.stringify({
              action: 'TELEMETRY',
              data: {
                cpu,
                ram: ramPct,
                ramUsedGb: usedGb,
                ramTotalGb: totalGb,
                net_upload: Math.max(0, Number(((currentTxBytes - prevTxBytes) / (1024 * 1024 * 1.5)).toFixed(2))) || 0,
                net_download: Math.max(0, Number(((currentRxBytes - prevRxBytes) / (1024 * 1024 * 1.5)).toFixed(2))) || 0,
                hostname: os.hostname(),
                uptime: Math.floor(os.uptime()),
                monitorsCount: getMonitorsCount(),
                track: currentTrack,
                artist: currentArtist,
                isPlaying: currentIsPlaying,
                volume: currentVolume,
                isMuted: currentIsMuted,
                isScreenStreaming: isAnyScreenStreamActive(),
                connectedClients: getConnectedDevicesCount()
              }
            }));
          }
          else if (action === 'STREAM_FRAME') {
            const startStreaming = data.start !== false && data.command !== 'STOP';
            ws.isStreaming = startStreaming;
            const requestedMonitor = Number.parseInt(data.monitorIndex ?? data.monitor ?? 0, 10);
            ws.monitorIndex = Number.isInteger(requestedMonitor) && requestedMonitor >= 0
              ? Math.min(requestedMonitor, Math.max(0, getMonitorsCount() - 1))
              : 0;
            applyStreamPreferences(ws, data);
            if (startStreaming) {
              if (!ws.frameInterval) {
                ws.frameInterval = setInterval(() => {
                  sendScreenFrame(ws, ws.monitorIndex || 0);
                }, 100);
              }
              await sendScreenFrame(ws, ws.monitorIndex || 0);
            } else {
              if (ws.frameInterval) {
                clearInterval(ws.frameInterval);
                ws.frameInterval = null;
              }
            }
            ws.send(JSON.stringify({
              action: 'STREAM_STATUS',
              status: 'SUCCESS',
              enabled: startStreaming,
              monitorIndex: ws.monitorIndex,
              quality: ws.streamQuality,
              resolution: ws.streamResolution
            }));
          }
          else if (action === 'TAKE_SCREENSHOT') {
            const sent = await sendScreenFrame(ws, Number.parseInt(data.monitorIndex ?? 0, 10) || 0, true);
            if (!sent) {
              ws.send(JSON.stringify({ action: 'TAKE_SCREENSHOT_RESPONSE', status: 'ERROR', error: 'Screen capture failed' }));
            }
          }
          else if (action === 'FRAME_ACK') {
            const sentAt = resolveFrameSentAt(ws, data);
            if (sentAt !== null) updateWsStreamTier(ws, Math.max(0, Date.now() - sentAt));
          }
          else if (action === 'FILE_START_ACK' || action === 'FILE_CHUNK_ACK' || action === 'FILE_END_ACK') {
            handleOutgoingFileAck(outgoingRendererTransfers, ws, data);
          }
          else if (['FILE_START', 'FILE_CHUNK', 'FILE_END', 'FILE_CANCEL'].includes(action)) {
            await incomingFileTransfers.handle(ws, data);
          }
          else if (action === 'AUDIO_STREAM') {
            const enabled = data.enabled !== false;
            ws.isAudioStreaming = enabled;
            ws.send(JSON.stringify({
              action: 'AUDIO_STREAM_STATUS',
              enabled: ws.isAudioStreaming,
              status: enabled ? 'PENDING' : 'SUCCESS'
            }));
            updateAudioCaptureState();
          }
          else {
            let targetAction = action;
            if (action === 'SYSTEM') {
              if (data.command === 'WRITE_CLIPBOARD') {
                targetAction = 'CLIPBOARD';
              }
            }

            const cmdData = {
              ...data,
              command: data.command || data.text || data.message || '',
              text: data.text || data.message || '',
              process_name: data.process_name || data.process || data.command || '',
              process: data.process || data.process_name || data.command || ''
            };

            const result = await executeSystemCommand(targetAction, cmdData);
            ws.send(JSON.stringify({
              action: `${action}_RESPONSE`,
              status: 'SUCCESS',
              ...result
            }));
          }

        } catch (err) {
          console.error('[WS] Message handling error:', err.message);
        }
      });

      ws.on('close', () => {
        clearTimeout(ws.authDeadline);
        ws.cancelSessionExpiry?.();
        aetherDeckClients.delete(ws);
        if (ws.pendingPairingRequestId) {
          const requestId = ws.pendingPairingRequestId;
          ws.pendingPairingRequestId = null;
          const pending = pendingPairingRequests.get(requestId);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('pairing-cancel', { requestId });
          }
          if (pending) pending.resolve(false);
        }
        if (ws.frameInterval) {
          clearInterval(ws.frameInterval);
          ws.frameInterval = null;
        }

        const fs = require('fs');
        for (const [fileId, transfer] of activeFileTransfers.entries()) {
          if (transfer.ws === ws) {
            console.log(`[FILE] Cleaning up transfer ${fileId} because ws closed.`);
            abortFileTransfer(fileId, true);
          }
        }
        ws.isAudioStreaming = false;
        handleOutgoingClientClosed(outgoingRendererTransfers, ws);
        updateAudioCaptureState();
      });
    });

    server.on('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error(`[SERVER] Critical Error: Port ${PORT} is already in use by another application or instance.`);
        if (Notification.isSupported()) {
          new Notification({
            title: 'Aether Remote Error',
            body: `Порт ${PORT} уже занят другим приложением. Закройте его или измените порт.`
          }).show();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('server-error', {
            code: 'EADDRINUSE',
            message: `Port ${PORT} is already occupied by another process.`
          });
        }
      } else {
        console.error('[SERVER] Network error:', err ? err.message : err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[HTTPS/WSS] Secure server listening on https://0.0.0.0:${PORT}`);
      startMdnsDiscovery(PORT);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hardware-info-updated', {
          hardwarePin: HARDWARE_PIN,
          pairingCode: ENCODED_PAIRING_CODE,
          ipAddress: LOCAL_IP,
          networkEndpoints: NETWORK_ENDPOINTS,
          macAddress: LOCAL_MAC,
          tlsFingerprint
        });
      }
    });

    ensureFirewallRule();
    startTelemetryBroadcaster(mainWindow);

    registerTrustedOn('pairing-response', (event, data = {}) => {
      if (!mainWindow || event.sender !== mainWindow.webContents) return;
      const pending = pendingPairingRequests.get(String(data.requestId || ''));
      if (pending) {
        pending.resolve({ approved: data.approved === true, trusted: data.trusted === true });
        rotatePairingSecret();
      }
    });

    registerTrustedHandle('get-clipboard-sharing', () => clipboardSharingStatus());
    registerTrustedHandle('set-clipboard-sharing', (_event, enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('Invalid clipboard sharing preference');
      require('fs').writeFileSync(clipboardSettingsPath, JSON.stringify({ enabled }), 'utf8');
      clipboardSharingEnabled = enabled;
      lastClipboardFingerprint = clipboardFingerprint(windowsInput.readClipboardText());
      return clipboardSharingStatus();
    });
    registerTrustedHandle('get-approved-tokens', async () => {
      const now = Date.now();
      return getTrustedTokenViews(now);
    });

    registerTrustedHandle('revoke-token', async (event, token) => {
      const normalizedToken = findTokenByPublicId(token);
      if (!normalizedToken) return { status: 'NOT_FOUND', wakeRevoked: false };
      const tokenInfo = authenticatedTokens.get(normalizedToken);
      const removed = authenticatedTokens.delete(normalizedToken);
      if (removed) savePersistedTokens();
      if (removed && wss?.clients) {
        for (const client of wss.clients) {
          if (client.sessionToken === normalizedToken) client.close(1008, 'Trusted phone revoked');
        }
      }
      if (removed) aetherDeckService?.revokeSession?.(normalizedToken);
      let wakeRevocation = null;
      if (removed && tokenInfo?.wakeDeviceId && wakeHostService) {
        wakeRevocation = await wakeHostService.revokeMember(tokenInfo.wakeDeviceId);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tokens-updated', getTrustedTokenViews());
      }
      return { status: removed ? 'SUCCESS' : 'NOT_FOUND', wakeRevoked: wakeRevocation?.ok === true };
    });

    registerTrustedHandle('open-download-folder', async (event, filePath) => {
      try {
        const { shell } = require('electron');
        const fs = require('fs');
        const resolvedPath = filePath ? path.resolve(String(filePath)) : '';
        const downloadDir = downloadDirectoryStore.get();
        const relative = resolvedPath ? path.relative(downloadDir, resolvedPath) : '';
        const isInsideDownloadDir = resolvedPath && relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        if (isInsideDownloadDir && fs.existsSync(resolvedPath)) {
          shell.showItemInFolder(resolvedPath);
        } else {
          await shell.openPath(downloadDir);
        }
        return { status: 'SUCCESS' };
      } catch (e) {
        return { status: 'ERROR', message: e.message };
      }
    });

    registerTrustedHandle('send-file-start', async (event, fileData = {}) => {
      const clients = wss ? Array.from(wss.clients).filter(c => c.readyState === WebSocket.OPEN && c.isAuth && c.capabilities instanceof Set && c.capabilities.has('file-transfer-v2')) : [];
      const size = Number(fileData.size);
      if (clients.length === 0) return { status: 'ERROR', error: 'No connected client supports reliable file transfer' };
      if (!Number.isSafeInteger(size) || size < 0 || size > 500 * 1024 * 1024) {
        return { status: 'ERROR', error: 'Invalid file size' };
      }
      const transferId = `drop-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const name = sanitizeFileName(fileData.name);
      const transfer = { transferId, name, size, sent: 0, clients, pendingAck: null, lastActivity: Date.now() };
      outgoingRendererTransfers.set(transferId, transfer);
      const message = JSON.stringify({ action: 'FILE_START', fileId: transferId, fileName: name, fileSize: size, chunkSize: 64 * 1024, mimeType: String(fileData.type || 'application/octet-stream') });
      try {
        await awaitOutgoingFileAck(transfer, 'FILE_START_ACK', message, outgoingFileAckTimeoutMs('FILE_START_ACK'));
        return { status: 'SUCCESS', transferId };
      } catch (error) {
        outgoingRendererTransfers.delete(transferId);
        return { status: 'ERROR', error: error.message };
      }
    });

    registerTrustedHandle('send-file-chunk-data', async (event, fileData = {}) => {
      const transferId = String(fileData.transferId || '');
      const transfer = outgoingRendererTransfers.get(transferId);
      if (!transfer) return { status: 'ERROR', error: 'Unknown outgoing transfer' };
      const offset = Number(fileData.offset);
      const encoded = String(fileData.data || '');
      const bytes = decodeBase64Strict(encoded);
      if (!Number.isSafeInteger(offset) || offset !== transfer.sent || !bytes) {
        return { status: 'ERROR', error: 'Invalid or out-of-order outgoing chunk' };
      }
      if (offset + bytes.length > transfer.size) return { status: 'ERROR', error: 'Outgoing chunk exceeds declared size' };
      const chunkIndex = Math.floor(offset / (64 * 1024));
      const progress = transfer.size === 0 ? 100 : Math.round(((offset + bytes.length) / transfer.size) * 100);
      const message = JSON.stringify({ action: 'FILE_CHUNK', fileId: transferId, chunkIndex, offset, data: encoded, progress });
      transfer.clients = transfer.clients.filter(client => client.readyState === WebSocket.OPEN && client.isAuth);
      if (transfer.clients.length === 0) {
        outgoingRendererTransfers.delete(transferId);
        return { status: 'ERROR', error: 'Mobile client disconnected during transfer' };
      }
      try {
        const ack = await awaitOutgoingFileAck(transfer, 'FILE_CHUNK_ACK', message, outgoingFileAckTimeoutMs('FILE_CHUNK_ACK'));
        const expectedBytes = offset + bytes.length;
        if (Number(ack.receivedBytes) !== expectedBytes) throw new Error('Mobile client reported an unexpected received byte count');
        transfer.sent = expectedBytes;
        transfer.lastActivity = Date.now();
        return { status: 'SUCCESS', sent: transfer.sent };
      } catch (error) {
        outgoingRendererTransfers.delete(transferId);
        return { status: 'ERROR', error: error.message };
      }
    });

    registerTrustedHandle('send-file-end', async (event, fileData = {}) => {
      const transferId = String(fileData.transferId || '');
      const transfer = outgoingRendererTransfers.get(transferId);
      if (!transfer) return { status: 'ERROR', error: 'Unknown outgoing transfer' };
      if (transfer.sent !== transfer.size) return { status: 'ERROR', error: `Incomplete outgoing file: ${transfer.sent}/${transfer.size}` };
      const message = JSON.stringify({ action: 'FILE_END', fileId: transferId, fileName: transfer.name, fileSize: transfer.size });
      try {
        await awaitOutgoingFileAck(transfer, 'FILE_END_ACK', message, outgoingFileAckTimeoutMs('FILE_END_ACK'));
        outgoingRendererTransfers.delete(transferId);
        return { status: 'SUCCESS' };
      } catch (error) {
        outgoingRendererTransfers.delete(transferId);
        return { status: 'ERROR', error: error.message };
      }
    });

    registerTrustedHandle('send-file-cancel', async (event, fileData = {}) => {
      const transferId = String(fileData.transferId || '');
      const transfer = outgoingRendererTransfers.get(transferId);
      if (!transfer) return { status: 'NOT_FOUND' };
      if (transfer.pendingAck) transfer.pendingAck.reject(new Error('Transfer cancelled by renderer'));
      const message = JSON.stringify({ action: 'FILE_CANCEL', fileId: transferId });
      transfer.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.isAuth) client.send(message);
      });
      outgoingRendererTransfers.delete(transferId);
      return { status: 'SUCCESS' };
    });

  } catch (e) {
    console.error('[SERVER] Failed to start:', e.message);
  }
}

const isAutoStart = process.argv.includes('--autostart');
let tray = null;
let mainWindow = null;
let isQuitting = false;
const { registerTrustedHandle, registerTrustedOn } = createTrustedIpcRegistrar({
  ipcMain,
  getMainWindow: () => mainWindow,
  entryPath: path.join(__dirname, 'dist', 'index.html')
});
let minimizeToTray = true;

function setAutoStart(enable) {
  app.setLoginItemSettings({
    openAtLogin: !!enable,
    openAsHidden: !!enable,
    args: enable ? ['--autostart'] : []
  });
}

function sendBootToastNotification() {
  const title = 'Aether Remote';
  const msg = `Aether Remote запущен в фоне на порту ${PORT}`;
  if (Notification.isSupported()) {
    new Notification({ title, body: msg }).show();
  }
}

function sendMinimizedToastNotification() {
  const title = 'Aether Remote';
  const msg = 'Aether Remote свернут в системный трей';
  if (Notification.isSupported()) {
    new Notification({ title, body: msg }).show();
  }
}

function createSystemTray() {
  if (tray) return;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'build', 'icon.png')
    : path.join(__dirname, 'build', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });

  tray = new Tray(icon);
  tray.setToolTip('Aether Remote');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Статус подключения',
      click: () => {
        const clientCount = wss ? Array.from(wss.clients).filter(c => c.readyState === 1 && c.isAuth).length : 0;
        const msg = `Статус: Активен | Подключено клиентов: ${clientCount}\nIP: ${LOCAL_IP}:${PORT}`;
        if (Notification.isSupported()) {
          new Notification({ title: 'Aether Remote', body: msg }).show();
        }
      }
    },
    {
      label: 'Показать QR-код',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Перезапустить сервер',
      click: () => {
        console.log('[SYSTEM] Restarting WebSocket server via Tray action');
        if (wss) {
          wss.clients.forEach(c => { try { c.close(); } catch(e){} });
        }
        if (Notification.isSupported()) {
          new Notification({ title: 'Aether Remote', body: 'Сетевые подключения сброшены, сервер перезапущен' }).show();
        }
      }
    },
    {
      type: 'separator'
    },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        if (wss) {
          wss.clients.forEach((client) => {
            try { client.close(); } catch (e) {}
          });
          try { wss.close(); } catch (e) {}
        }
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  const restoreWindow = () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }
  };

  tray.on('click', restoreWindow);
  tray.on('double-click', restoreWindow);
}

async function createWindow() {
  if (session.defaultSession && typeof session.defaultSession.setDisplayMediaRequestHandler === 'function') {
    session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        callback({ video: sources[0], audio: 'loopback' });
      } catch (error) {
        console.error('[AUDIO] Failed to authorize loopback capture:', error.message);
        callback({});
      }
    });
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    backgroundColor: '#000000',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'build', 'icon.png')
      : path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: !isAutoStart,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  const rendererEntryPath = path.join(__dirname, 'dist', 'index.html');
  const rendererEntryUrl = pathToFileURL(rendererEntryPath).href;
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (String(navigationUrl) !== rendererEntryUrl) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.on('render-process-gone', () => {
    abortOutgoingRendererTransfers(outgoingRendererTransfers, 'Renderer process terminated during file transfer');
  });
  mainWindow.webContents.on('did-start-loading', () => {
    abortOutgoingRendererTransfers(outgoingRendererTransfers, 'Renderer reloaded during file transfer');
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  mainWindow.loadFile(rendererEntryPath);

  await startStaticServer(mainWindow);
  createSystemTray();

  if (isAutoStart) {
    sendBootToastNotification();
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      sendMinimizedToastNotification();
      return false;
    }
  });

  registerTrustedHandle('get-system-info', () => ({
    ipAddress: LOCAL_IP,
    networkEndpoints: NETWORK_ENDPOINTS,
    port: PORT,
    hostname: os.hostname(),
    osVersion: `${os.type()} ${os.release()}`,
    hardwareUuid: HARDWARE_UUID,
    hardwarePin: HARDWARE_PIN,
    pairingCode: ENCODED_PAIRING_CODE,
    tlsFingerprint
  }));
  registerTrustedHandle('wake-bridge:get-status', () => wakeHostStatus);
  registerTrustedHandle('wake-bridge:set-enabled', async (_event, enabled) => {
    if (!wakeHostService) return { ok: false, code: 'wake_bridge_unconfigured' };
    return wakeHostService.setBridgeEnabled(enabled === true);
  });
  registerTrustedHandle('wake-bridge:revoke-member', async (_event, deviceId) => {
    if (!wakeHostService) return { ok: false, code: 'wake_bridge_unconfigured' };
    return wakeHostService.revokeMember(String(deviceId || ''));
  });
  registerTrustedHandle('wake-bridge:add-target', (_event, target = {}) => {
    if (!wakeHostService) return { ok: false, code: 'wake_bridge_unconfigured' };
    return wakeHostService.registerTarget({ name: String(target.name || ''), mac: String(target.mac || '') });
  });

  registerTrustedHandle('aether-deck:get-document', () => aetherDeckStore.getSnapshot());
  registerTrustedHandle('aether-deck:get-providers', () => aetherDeckRegistry.describe());
  registerTrustedHandle('aether-deck:save-document', async (event, document) => {
    if (event.sender !== mainWindow.webContents) throw new Error('Invalid Aether Deck editor');
    return aetherDeckService.applyEditorDocument(document);
  });
  registerTrustedHandle('aether-deck:select-asset', async (event) => {
    if (event.sender !== mainWindow.webContents) throw new Error('Invalid Aether Deck editor');
    return selectDeckAsset({
      showOpenDialog: () => dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] }),
      assetStore: aetherDeckAssetStore
    });
  });
  registerTrustedHandle('get-download-folder', () => ({ status: 'SUCCESS', path: downloadDirectoryStore.get() }));
  registerTrustedHandle('select-download-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Выберите папку загрузок',
      defaultPath: downloadDirectoryStore.get(),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { status: 'CANCELED', path: downloadDirectoryStore.get() };
    return { status: 'SUCCESS', path: downloadDirectoryStore.set(result.filePaths[0]) };
  });
  registerTrustedHandle('aether-deck:select-application', async (event) => {
    if (event.sender !== mainWindow.webContents) throw new Error('Invalid Aether Deck editor');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Приложения и ярлыки', extensions: ['exe', 'com', 'lnk'] },
        { name: 'Все файлы', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  });
  registerTrustedHandle('aether-deck:export', async (event) => {
    if (event.sender !== mainWindow.webContents) throw new Error('Invalid Aether Deck editor');
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: 'Aether Deck.aetherdeck', filters: [{ name: 'Aether Deck', extensions: ['aetherdeck'] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const text = await exportDeckPackage({ document: aetherDeckStore.getSnapshot(), assetStore: aetherDeckAssetStore });
    require('fs').writeFileSync(result.filePath, text, 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
  registerTrustedHandle('aether-deck:import', async (event) => {
    if (event.sender !== mainWindow.webContents) throw new Error('Invalid Aether Deck editor');
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Aether Deck', extensions: ['aetherdeck'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const imported = await importDeckPackage(require('fs').readFileSync(result.filePaths[0], 'utf8'), { assetStore: aetherDeckAssetStore });
    const document = await aetherDeckService.applyEditorDocument(imported.document);
    return { canceled: false, document, assetCount: imported.assetCount };
  });
  registerTrustedHandle('aether-deck:get-obs-settings', () => ({ url: aetherDeckObsSettings.url, connected: aetherDeckObsClient.isConnected() }));
  registerTrustedHandle('aether-deck:set-obs-settings', async (event, settings = {}) => {
    if (event.sender !== mainWindow.webContents) throw new Error('Invalid Aether Deck editor');
    const url = String(settings.url || 'ws://127.0.0.1:4455');
    const parsed = new URL(url);
    if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error('OBS URL must use ws:// or wss://');
    const nextSettings = { url: parsed.toString(), password: String(settings.password || '') };
    const directory = path.join(app.getPath('userData'), 'Aether Deck');
    saveAetherDeckObsSettings(directory, nextSettings);
    aetherDeckObsSettings = nextSettings;
    aetherDeckObsClient.configure(aetherDeckObsSettings);
    await aetherDeckObsClient.connect();
    return { url: aetherDeckObsSettings.url, connected: true };
  });

  registerTrustedOn('set-autostart', (event, enable) => {
    setAutoStart(enable);
  });

  registerTrustedOn('set-minimize-to-tray', (event, enable) => {
    minimizeToTray = enable;
  });

  registerTrustedOn('audio-pcm-chunk', (event, payload) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || !wss) return;
    const bytes = Buffer.from(payload && payload.data ? payload.data : []);
    if (bytes.length === 0 || bytes.length > 512 * 1024) return;
    const packet = Buffer.allocUnsafe(bytes.length + 1);
    packet[0] = 0x02;
    bytes.copy(packet, 1);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN && client.isAuth && client.isAudioStreaming && client.bufferedAmount < 512 * 1024) {
        client.send(packet, { binary: true });
      }
    });
  });

  registerTrustedOn('audio-capture-status', (event, payload = {}) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    const enabled = payload.enabled === true;
    if (!enabled && wss) {
      wss.clients.forEach(client => { client.isAudioStreaming = false; });
    }
    broadcastAudioStatus(enabled, payload.error ? 'ERROR' : 'SUCCESS', String(payload.error || ''));
  });

  registerTrustedOn('force-disconnect-client', () => {
    console.log('[HOST] Force disconnect requested for all active clients');
    if (wss && wss.clients) {
      wss.clients.forEach((c) => {
        try {
          if (c.frameInterval) {
            clearInterval(c.frameInterval);
            c.frameInterval = null;
          }
          c.isStreaming = false;
          c.isAudioStreaming = false;
          if (c.readyState === WebSocket.OPEN) {
            c.send(
              JSON.stringify({ status: 'FORCE_DISCONNECTED', reason: 'Disconnected by host operator' }),
              () => {
                try { c.close(4001, 'Force disconnect requested by host'); } catch (e) {}
              }
            );
            setTimeout(() => {
              try { if (c.readyState !== WebSocket.CLOSED) c.terminate(); } catch (e) {}
            }, 750);
          } else if (c.readyState !== WebSocket.CLOSED) {
            c.terminate();
          }
        } catch (e) {}
      });
    }
    authenticatedTokens.clear();
    savePersistedTokens();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('client-disconnected');
    }
  });
}

app.on('before-quit', () => {
  accountHostService?.dispose();
  isQuitting = true;
  networkChangeMonitor?.stop();
  networkChangeMonitor = null;
  wakeHostService?.stop();
  wakeHostService = null;
  aetherDeckForegroundObserver?.stop();
  aetherDeckForegroundObserver = null;
  aetherDeckProviderUnsubscribe?.();
  aetherDeckProviderUnsubscribe = null;
  aetherDeckObsClient?.disconnect();
  windowsAudio.close?.();
  windowsMedia.close?.();
  if (controlServer) {
    try { controlServer.close(); } catch (_) {}
    controlServer = null;
  }
  if (fastInputHelper) {
    try { fastInputHelper.stdin.end(); } catch (e) {}
    try { fastInputHelper.kill(); } catch (e) {}
    fastInputHelper = null;
  }
  stopMdnsDiscovery();
  if (udpBeaconInterval) clearInterval(udpBeaconInterval);
  udpBeaconInterval = null;
  if (udpBeaconSocket) {
    try { udpBeaconSocket.close(); } catch (e) {}
    udpBeaconSocket = null;
  }
});

const dgram = require('dgram');
let udpBeaconSocket = null;
let udpBeaconInterval = null;

function getBroadcastAddress(ip) {
  try {
    const interfaces = os.networkInterfaces();
    let netmask = '255.255.255.0';
    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.address === ip && addr.netmask) {
          netmask = addr.netmask;
          break;
        }
      }
    }
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);
    if (ipParts.length !== 4 || maskParts.length !== 4) {
      return '255.255.255.255';
    }
    const broadcastParts = [];
    for (let i = 0; i < 4; i++) {
      broadcastParts.push(ipParts[i] | ((~maskParts[i]) & 255));
    }
    return broadcastParts.join('.');
  } catch (e) {
    return '255.255.255.255';
  }
}

function getAllPhysicalBroadcastAddresses() {
  return collectBroadcastTargets(os.networkInterfaces());
}

function sendUdpDiscoveryBeacon() {
  const udpClient = udpBeaconSocket;
  if (!udpClient) return;
  try {
    refreshLocalNetworkIdentity();
    const beaconMsg = Buffer.from(JSON.stringify({
      ip: LOCAL_IP,
      port: PORT,
      host: os.hostname(),
      mac: LOCAL_MAC,
      protocolVersion: '2.0',
      secure: true,
      tlsFingerprint
    }));

    for (const targetAddr of getAllPhysicalBroadcastAddresses()) {
      udpClient.send(beaconMsg, 0, beaconMsg.length, 8081, targetAddr, () => {});
    }
  } catch (error) {
    console.error('[UDP] Beacon broadcast error:', error.message);
  }
}

function startUdpDiscoveryBeacon() {
  if (udpBeaconSocket) return;
  const udpClient = dgram.createSocket('udp4');
  udpBeaconSocket = udpClient;
  
  udpClient.bind(0, () => {
    try {
      udpClient.setBroadcast(true);
      sendUdpDiscoveryBeacon();
    } catch (e) {
      console.error('[UDP] Failed to set broadcast flag:', e.message);
    }
  });

  udpBeaconInterval = setInterval(sendUdpDiscoveryBeacon, 2000);
}

function startNetworkChangeMonitor() {
  if (networkChangeMonitor) return;
  networkChangeMonitor = createNetworkChangeMonitor({
    getNetworkInterfaces: () => os.networkInterfaces(),
    onChange() {
      refreshLocalNetworkIdentity();
      sendUdpDiscoveryBeacon();
      if (bonjourService) startMdnsDiscovery(PORT);
      void accountHostService?.refresh().catch(() => {});
      console.log(`[Network] Interfaces changed; discovery refreshed for ${LOCAL_IP}.`);
    }
  });
  networkChangeMonitor.start();
}

app.whenReady().then(async () => {
  try {
    accountHostService = await AccountHostService.create({ userData: app.getPath('userData'), safeStorage,
      acceptRelayStream: (stream, sessionId) => {
        if (!controlServer?.listening || !acceptAccountRelayStream) { stream.destroy(); return; }
        acceptAccountRelayStream(stream, sessionId);
      },
      getHost: () => ({ name: os.hostname(), tlsFingerprint: tlsFingerprint.replace(/^SHA256:/, '').toLowerCase(),
        lanIp: isPrivateLanHostname(LOCAL_IP) && !LOCAL_IP.startsWith('127.') ? LOCAL_IP : null,
        networkEndpoints: NETWORK_ENDPOINTS.map(endpoint => endpoint.address), port: PORT }),
      requestApproval: async (ip, description) => (await requestHostApproval(mainWindow, ip, description, 'account')).approved
    });
    accountHostService.on('change', state => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('account-state', state);
    });
  } catch { console.warn('[ACCOUNT] Protected account storage is unavailable.'); }
  registerTrustedHandle('account:get-state', () => accountHostService?.snapshot() ?? { unavailable: true });
  registerTrustedHandle('account:action', async (_event, payload) => {
    if (!accountHostService || !payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, message: 'Аккаунт недоступен.' };
    try {
      switch (payload.action) {
        case 'sign-in': return await accountHostService.auth.signIn(payload.email, payload.password);
        case 'sign-up': return await accountHostService.auth.signUp(payload.email, payload.password);
        case 'recover': return await accountHostService.auth.recover(payload.email);
        case 'update-password': return await accountHostService.auth.updatePassword(payload.password);
        case 'cancel': accountHostService.auth.cancelSignIn(); return { ok: true };
        case 'sign-out': return await accountHostService.signOut();
        case 'refresh': await accountHostService.refresh(); return { ok: true };
        case 'rename': await accountHostService.rename(payload.id, payload.name); return { ok: true };
        case 'revoke': await accountHostService.revoke(payload.id); return { ok: true };
        default: return { ok: false, message: 'Неизвестная операция аккаунта.' };
      }
    } catch { return { ok: false, message: 'Не удалось обновить устройства. Проверьте интернет.' }; }
  });
  loadPersistedTokens();
  asyncInitializeHardwareInfo();
  startUdpDiscoveryBeacon();
  await initializeAetherDeck();
  await initializeWakeBridge();
  await createWindow();
  startNetworkChangeMonitor();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
