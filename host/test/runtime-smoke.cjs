const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const net = require('node:net');
const WebSocket = require('ws');
const { createWindowsAudioController } = require('../lib/windows-audio.cjs');

const delay = (milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds));
const rendererEvaluationTimeoutMs = 15000;
let runtimePort = 8080;

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function secureHttpResponse(hostname, pathname = '/health') {
  return new Promise((resolve, reject) => {
    const request = https.get(`https://${hostname}:${runtimePort}${pathname}`, { rejectUnauthorized: false, timeout: 1500 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: { get: name => response.headers[String(name).toLowerCase()] },
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }));
    });
    request.once('timeout', () => request.destroy(new Error('HTTPS request timed out')));
    request.once('error', reject);
  });
}

async function secureHttpStatus(pathname) {
  return (await secureHttpResponse('127.0.0.1', pathname)).status;
}

function exchange(message, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${runtimePort}`, { rejectUnauthorized: false, ...options });
    const timeout = setTimeout(() => reject(new Error('WebSocket response timed out')), 5000);
    socket.once('open', () => socket.send(JSON.stringify(message)));
    socket.once('message', raw => {
      clearTimeout(timeout);
      const response = JSON.parse(String(raw));
      socket.close();
      resolve(response);
    });
    socket.once('error', reject);
  });
}

function primaryLocalIp() {
  const virtual = /(vEthernet|VirtualBox|VMware|WSL|Loopback|TAP|Tun|Hyper-V|docker)/i;
  const entries = Object.entries(os.networkInterfaces());
  for (const preferred192 of [true, false]) {
    for (const [name, addresses] of entries) {
      if (virtual.test(name)) continue;
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal && (preferred192 ? address.address.startsWith('192.168.') : true)) return address.address;
      }
    }
  }
  return '127.0.0.1';
}

function waitForSocketMessage(socket, predicate, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('WebSocket response timed out'));
    }, timeoutMs);
    const onMessage = raw => {
      const response = JSON.parse(String(raw));
      if (!predicate(response)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(response);
    };
    socket.on('message', onMessage);
  });
}

function pendingSession(pin, deviceModel = 'Runtime smoke test') {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${runtimePort}`, { rejectUnauthorized: false });
    const timeout = setTimeout(() => reject(new Error('Pending authentication timed out')), 7000);
    socket.once('open', () => socket.send(JSON.stringify({ action: 'AUTH', pin, deviceModel })));
    socket.once('message', raw => {
      clearTimeout(timeout);
      const response = JSON.parse(String(raw));
      if (response.status !== 'AUTH_PENDING') {
        socket.close();
        reject(new Error(`Expected AUTH_PENDING, received: ${JSON.stringify(response)}`));
        return;
      }
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

async function waitForRenderer(expression, expected = true, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await rendererValue(expression) === expected) return;
    await delay(100);
  }
  throw new Error(`Renderer condition timed out: ${expression}`);
}

async function clickRendererButton(label) {
  const serialized = JSON.stringify(label);
  const clicked = await rendererValue(`(() => { const button = Array.from(document.querySelectorAll('button')).find(item => (item.textContent || '').trim() === ${serialized}); if (!button) return false; button.click(); return true; })()`);
  assert.equal(clicked, true, `Renderer button was not found: ${label}`);
}

async function waitForHostReady(child, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Electron host exited during startup with code ${child.exitCode}`);
    try {
      const response = await secureHttpResponse('127.0.0.1');
      if (response.status === 200) return response;
    } catch (_) {}
    await delay(150);
  }
  throw new Error('Electron host did not open the health endpoint within 20 seconds');
}

async function authenticatedSession(pin) {
  const socket = await pendingSession(pin);
  await waitForRenderer(`document.body.innerText.includes('Runtime smoke test')`);
  assert.equal(await rendererValue(`Array.from(document.querySelectorAll('button')).some(button => (button.textContent || '').trim() === 'Подключить')`), true);
  assert.equal(await rendererValue(`Array.from(document.querySelectorAll('button')).some(button => (button.textContent || '').trim() === 'Отклонить')`), true);
  const approved = waitForSocketMessage(socket, response => response.status === 'AUTH_OK');
  await clickRendererButton('Подключить');
  const auth = await approved;
  return { socket, auth };
}

function tokenSession(sessionToken, deviceModel) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`wss://127.0.0.1:${runtimePort}`, { rejectUnauthorized: false });
    const timeout = setTimeout(() => reject(new Error('Token authentication timed out')), 7000);
    socket.once('open', () => socket.send(JSON.stringify({ action: 'AUTH', sessionToken, deviceModel })));
    socket.once('message', raw => {
      clearTimeout(timeout);
      resolve({ socket, response: JSON.parse(String(raw)) });
    });
    socket.once('error', reject);
  });
}

function request(socket, message, expectedActionOverride = null) {
  return new Promise((resolve, reject) => {
    const expectedAction = expectedActionOverride || (message.action === 'GET_TELEMETRY' ? 'TELEMETRY' : `${message.action}_ACK`);
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Response timed out for ${message.action}`));
    }, 7000);
    const onMessage = (raw, isBinary) => {
      if (isBinary) return;
      const response = JSON.parse(String(raw));
      if (response.action !== expectedAction) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(response);
    };
    socket.on('message', onMessage);
    socket.send(JSON.stringify(message));
  });
}

async function evaluateRenderer(expression) {
  const pages = await (await fetch('http://127.0.0.1:9333/json', { signal: AbortSignal.timeout(2000) })).json();
  const page = pages.find(item => item.type === 'page');
  assert.ok(page && page.webSocketDebuggerUrl, 'Electron renderer debug target was not found');
  const debuggerSocket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    debuggerSocket.once('open', resolve);
    debuggerSocket.once('error', reject);
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Renderer evaluation timed out')),
      rendererEvaluationTimeoutMs
    );
    debuggerSocket.on('message', raw => {
      const payload = JSON.parse(String(raw));
      if (payload.id !== 1) return;
      clearTimeout(timeout);
      resolve(payload);
    });
    debuggerSocket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }));
  });
  await closeDebuggerSocket(debuggerSocket);
  assert.equal(result.result.exceptionDetails, undefined, 'Renderer evaluation failed');
}

async function rendererValue(expression) {
  const pages = await (await fetch('http://127.0.0.1:9333/json', { signal: AbortSignal.timeout(2000) })).json();
  const page = pages.find(item => item.type === 'page');
  assert.ok(page && page.webSocketDebuggerUrl, 'Electron renderer debug target was not found');
  const debuggerSocket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    debuggerSocket.once('open', resolve);
    debuggerSocket.once('error', reject);
  });
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Renderer evaluation timed out')),
      rendererEvaluationTimeoutMs
    );
    debuggerSocket.on('message', raw => {
      const payload = JSON.parse(String(raw));
      if (payload.id !== 1) return;
      clearTimeout(timeout);
      resolve(payload);
    });
    debuggerSocket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
  });
  await closeDebuggerSocket(debuggerSocket);
  assert.equal(result.result.exceptionDetails, undefined, 'Renderer evaluation failed');
  return result.result.result.value;
}

function closeDebuggerSocket(socket) {
  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 250);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.close();
  });
}

async function run() {
  runtimePort = await findAvailablePort();
  const electronPath = process.env.AETHER_HOST_EXE || path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
  const runtimeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-runtime-smoke-'));
  const child = spawn(electronPath, [...(process.env.AETHER_HOST_EXE ? [] : ['.']), '--autostart', '--remote-debugging-port=9333', `--user-data-dir=${runtimeUserData}`], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, AETHER_RUNTIME_TEST: '1', AETHER_TEST_PORT: String(runtimePort) }
  });

  try {
    const healthResponse = await waitForHostReady(child);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.status, 'ok');
    assert.equal(health.protocolVersion, '2.0');
    assert.equal(health.port, runtimePort);
    assert.equal(health.host, undefined, 'Unauthenticated health data must not disclose the host identity');
    assert.equal(health.mac, undefined, 'Unauthenticated health data must not disclose the MAC address');
    assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(healthResponse.headers.get('cache-control'), 'no-store');
    const lanHealthResponse = await secureHttpResponse(primaryLocalIp());
    assert.equal(lanHealthResponse.status, 200, 'Health endpoint must be reachable through the LAN address');
    assert.equal(await secureHttpStatus('/'), 404, 'Host UI must not be exposed over LAN');

    const unauthenticated = await exchange({ action: 'GET_TELEMETRY' });
    assert.equal(unauthenticated.status, 'AUTH_REQUIRED');
    await waitForRenderer("typeof window.require === 'function'");
    await waitForRenderer("document.body.innerText.includes('Aether Deck')");
    assert.deepEqual(await rendererValue("window.require('electron').ipcRenderer.invoke('get-clipboard-sharing')"), { enabled: false, recipients: 0 });
    assert.equal((await rendererValue("window.require('electron').ipcRenderer.invoke('set-clipboard-sharing', true)")).enabled, true);
    assert.equal((await rendererValue("window.require('electron').ipcRenderer.invoke('set-clipboard-sharing', false)")).enabled, false);
    const systemInfo = await rendererValue("window.require('electron').ipcRenderer.invoke('get-system-info')");
    assert.equal(Array.isArray(systemInfo.networkEndpoints), true);
    assert.equal(systemInfo.networkEndpoints.some(endpoint => endpoint.address === systemInfo.ipAddress), true,
      'primary LAN address must be available as a QR endpoint');
    const ipParts = String(systemInfo.ipAddress).split('.');
    const currentPairingCode = async () => (await rendererValue("window.require('electron').ipcRenderer.invoke('get-system-info')")).pairingCode;
    const hostPairingCode = `${String(Number(ipParts[2]) || 1).padStart(3, '0')}${String(Number(ipParts[3]) || 50).padStart(3, '0')}${systemInfo.hardwarePin}`;
    if (process.env.AETHER_ANDROID_SERIAL) {
      await require('./android_client_smoke.cjs').runAndroidClientSmoke({
        port: runtimePort, pin: hostPairingCode, fingerprint: systemInfo.tlsFingerprint,
        rendererValue, evaluateRenderer
      });
    }

    const alternateEndpoint = systemInfo.networkEndpoints.find(endpoint => endpoint.address !== systemInfo.ipAddress);
    const alternateParts = String(alternateEndpoint?.address || systemInfo.ipAddress).split('.');
    const alternateThird = Number.parseInt(alternateParts[2], 10);
    const alternateFourth = Number.parseInt(alternateParts[3], 10);
    const cancellationPairingCode = alternateEndpoint
      ? `${String(Number.isNaN(alternateThird) ? 1 : alternateThird).padStart(3, '0')}${String(Number.isNaN(alternateFourth) ? 50 : alternateFourth).padStart(3, '0')}${systemInfo.hardwarePin}`
      : await currentPairingCode();
    const cancelledSession = await pendingSession(cancellationPairingCode, 'Cancelled runtime test');
    await waitForRenderer(`document.body.innerText.includes('Cancelled runtime test')`);
    const concurrentPairing = await exchange({ action: 'AUTH', pin: await currentPairingCode(), deviceModel: 'Duplicate prompt test' });
    assert.equal(concurrentPairing.status, 'AUTH_REJECTED', 'Only one pairing prompt may be visible');
    const cancelledClosed = new Promise(resolve => cancelledSession.once('close', resolve));
    cancelledSession.close(1000, 'Cancelled by phone');
    await cancelledClosed;
    await waitForRenderer(`document.body.innerText.includes('Cancelled runtime test')`, false);

    const rejectedSession = await pendingSession(await currentPairingCode(), 'Rejected runtime test');
    await waitForRenderer(`document.body.innerText.includes('Rejected runtime test')`);
    const rejected = waitForSocketMessage(rejectedSession, response => response.status === 'AUTH_REJECTED');
    const rejectedClosed = new Promise(resolve => rejectedSession.once('close', resolve));
    await clickRendererButton('Отклонить');
    await rejected;
    await rejectedClosed;
    await waitForRenderer(`document.body.innerText.includes('Rejected runtime test')`, false);
    console.log('Pairing rejection test passed.');

    const firstApproval = await authenticatedSession(await currentPairingCode());
    assert.equal(firstApproval.auth.trusted, false, 'unchecked approval must not trust the phone');
    firstApproval.socket.close();

    const nonTrustedReconnect = await tokenSession(firstApproval.auth.sessionToken, 'Promote trusted runtime test');
    assert.equal(nonTrustedReconnect.response.status, 'AUTH_PENDING', 'non-trusted token must prompt again');
    await waitForRenderer(`document.body.innerText.includes('Promote trusted runtime test')`);
    assert.equal(await rendererValue(`document.querySelector('input[type="checkbox"]')?.checked === false`), true);
    await evaluateRenderer(`document.querySelector('input[type="checkbox"]')?.click()`);
    const promoted = waitForSocketMessage(nonTrustedReconnect.socket, response => response.status === 'AUTH_OK');
    await clickRendererButton('Подключить');
    const promotedAuth = await promoted;
    assert.equal(promotedAuth.trusted, true);
    await waitForRenderer(`document.body.innerText.includes('Promote trusted runtime test')`, false);
    const trustedTokens = await rendererValue(`window.require('electron').ipcRenderer.invoke('get-approved-tokens')`);
    const publicTokenId = crypto.createHash('sha256').update(promotedAuth.sessionToken, 'utf8').digest('hex');
    assert.equal(trustedTokens.some(item => item.token === publicTokenId && item.trusted === true), true);
    assert.equal(trustedTokens.some(item => item.token === promotedAuth.sessionToken), false, 'renderer must not receive bearer tokens');
    nonTrustedReconnect.socket.close();

    const trustedReconnect = await tokenSession(promotedAuth.sessionToken, 'Trusted reconnect runtime test');
    assert.equal(trustedReconnect.response.status, 'AUTH_OK', 'trusted token must bypass the PC prompt');
    assert.equal(trustedReconnect.response.trusted, true);
    assert.equal(trustedReconnect.response.platform, process.platform);
    const session = trustedReconnect.socket;
    console.log('Pairing trust promotion and reconnect tests passed.');
    const telemetry = await request(session, { action: 'GET_TELEMETRY' });
    assert.equal(telemetry.action, 'TELEMETRY');
    assert.ok(telemetry.data.monitorsCount >= 1);
    assert.ok(telemetry.data.volume === null || (telemetry.data.volume >= 0 && telemetry.data.volume <= 100));
    assert.equal(telemetry.data.isScreenStreaming, false);

    const volumeTarget = telemetry.data.volume === null ? 40 : telemetry.data.volume;
    const volumeResponse = await request(
      session,
      { action: 'MEDIA', command: 'VOLUME_SET', value: volumeTarget },
      'MEDIA_RESPONSE'
    );
    assert.equal(volumeResponse.status, 'MEDIA_EXECUTED');
    assert.equal(volumeResponse.volume, volumeTarget);
    assert.equal(/\uFFFD/.test(JSON.stringify(volumeResponse)), false, 'Volume response contains replacement characters');

    const playPauseResponse = await request(
      session,
      { action: 'MEDIA', command: 'PLAY_PAUSE' },
      'MEDIA_RESPONSE'
    );
    assert.equal(playPauseResponse.status, 'MEDIA_EXECUTED');
    assert.equal(playPauseResponse.command, 'PLAY_PAUSE');
    assert.equal(/\uFFFD/.test(JSON.stringify(playPauseResponse)), false, 'Play/Pause response contains replacement characters');
    const playPauseRestoreResponse = await request(
      session,
      { action: 'MEDIA', command: 'PLAY_PAUSE' },
      'MEDIA_RESPONSE'
    );
    assert.equal(playPauseRestoreResponse.status, 'MEDIA_EXECUTED');
    assert.equal(playPauseRestoreResponse.command, 'PLAY_PAUSE');
    assert.equal(/\uFFFD/.test(JSON.stringify(playPauseRestoreResponse)), false, 'Second Play/Pause response contains replacement characters');
    console.log('Play/Pause protocol test passed.');

    const audioController = createWindowsAudioController();
    const externalVolume = volumeTarget >= 99 ? volumeTarget - 1 : volumeTarget + 1;
    await audioController.setVolume(externalVolume);
    try {
      let synchronizedTelemetry = null;
      const synchronizationDeadline = Date.now() + 2000;
      do {
        synchronizedTelemetry = await request(session, { action: 'GET_TELEMETRY' });
        if (synchronizedTelemetry.data.volume === externalVolume) break;
        await delay(80);
      } while (Date.now() < synchronizationDeadline);
      assert.equal(synchronizedTelemetry.data.volume, externalVolume, 'Telemetry must synchronize a local Windows volume change within the propagation window');
      assert.equal(/\uFFFD/.test(JSON.stringify(synchronizedTelemetry.data)), false, 'Telemetry contains replacement characters');
    } finally {
      await audioController.setVolume(volumeTarget);
      audioController.close();
    }

    assert.equal(await rendererValue(`Array.from(document.querySelectorAll('button')).some(button => /^(1080p|720p|480p)$/.test((button.textContent || '').trim()))`), false);
    assert.equal(await rendererValue(`document.body.innerText.includes('Пауза эфира')`), false);
    assert.equal(await rendererValue(`document.body.innerText.includes('Стрим выключен')`), true);

    const streamStarted = await request(
      session,
      { action: 'STREAM_FRAME', start: true, monitorIndex: 0 },
      'STREAM_STATUS'
    );
    assert.equal(streamStarted.enabled, true);
    await waitForRenderer(`document.body.innerText.includes('Стрим запущен')`, true, 10000);

    const streamStopped = await request(
      session,
      { action: 'STREAM_FRAME', start: false, monitorIndex: 0 },
      'STREAM_STATUS'
    );
    assert.equal(streamStopped.enabled, false);
    await waitForRenderer(`document.body.innerText.includes('Стрим выключен')`, true, 10000);

    const testBytes = Buffer.from('Aether Remote file transfer smoke test', 'utf8');
    const fileId = `smoke-${Date.now()}`;
    const fileName = `${fileId}.txt`;
    assert.equal((await request(session, { action: 'FILE_START', fileId, fileName, fileSize: testBytes.length, chunkSize: 65536 })).status, 'SUCCESS');
    assert.equal((await request(session, { action: 'FILE_CHUNK', fileId, offset: 0, chunkIndex: 0, data: testBytes.toString('base64') })).status, 'SUCCESS');
    const fileEnd = await request(session, { action: 'FILE_END', fileId });
    assert.equal(fileEnd.status, 'SUCCESS');
    assert.equal(fileEnd.filePath, undefined, 'wire response must not disclose the host filesystem path');
    assert.equal(fileEnd.fileName, fileName);
    const downloadFolder = await rendererValue(`window.require('electron').ipcRenderer.invoke('get-download-folder')`);
    const receivedPath = path.join(downloadFolder.path, fileName);
    assert.deepEqual(fs.readFileSync(receivedPath), testBytes);
    fs.unlinkSync(receivedPath);
    console.log('Connected feature regression tests passed.');

    const forcedDisconnect = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Force disconnect notification timed out')),
        rendererEvaluationTimeoutMs
      );
      session.on('message', raw => {
        const payload = JSON.parse(String(raw));
        if (payload.status !== 'FORCE_DISCONNECTED') return;
        clearTimeout(timeout);
        resolve(payload);
      });
    });
    await evaluateRenderer("window.require('electron').ipcRenderer.send('force-disconnect-client')");
    assert.equal((await forcedDisconnect).status, 'FORCE_DISCONNECTED');
    console.log('Force disconnect regression test passed.');

    const invalidAuth = await exchange({ action: 'AUTH', pin: '000000000', deviceModel: 'Runtime smoke test' });
    assert.equal(invalidAuth.status, 'AUTH_FAILED');
    assert.equal(invalidAuth.remainingAttempts, 2);

    const secondInvalidAuth = await exchange({ action: 'AUTH', pin: '000000000', deviceModel: 'Runtime smoke test' });
    assert.equal(secondInvalidAuth.status, 'AUTH_FAILED');
    assert.equal(secondInvalidAuth.remainingAttempts, 1);

    const thirdInvalidAuth = await exchange({ action: 'AUTH', pin: '000000000', deviceModel: 'Runtime smoke test' });
    assert.equal(thirdInvalidAuth.status, 'AUTH_BLOCKED');
    assert.equal(thirdInvalidAuth.remainingAttempts, 0);

    const lockedAuth = await exchange({ action: 'AUTH', pin: '000000000', deviceModel: 'Runtime smoke test' });
    assert.equal(lockedAuth.status, 'AUTH_BLOCKED');

    const blockedOrigin = await exchange(
      { action: 'AUTH', pin: '000000000' },
      { headers: { Origin: 'https://untrusted.example' } }
    );
    assert.equal(blockedOrigin.status, 'AUTH_BLOCKED');

    console.log('Electron runtime smoke tests passed.');
  } finally {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill();
    }
    if (child.exitCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)]);
    // Windows can retain Chromium file handles briefly after the process exits.
    fs.rmSync(runtimeUserData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
