const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

async function runAndroidClientSmoke({ port, pin, fingerprint, rendererValue, evaluateRenderer }) {
  const adb = process.env.AETHER_ADB || path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe');
  const serial = process.env.AETHER_ANDROID_SERIAL;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-android-test-'));
  const fixture = path.join(temporary, 'fixture.json');
  const prefix = `aether-android-${Date.now()}`;
  fs.writeFileSync(fixture, JSON.stringify({ port, pin, fingerprint, prefix }));
  const adbSync = args => {
    const result = spawnSync(adb, ['-s', serial, ...args], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, 'Android test setup failed');
    return result.stdout;
  };
  let child;
  const createdFiles = [];
  try {
    adbSync(['push', fixture, '/data/local/tmp/aether-host-fixture.json']);
    child = spawn(adb, ['-s', serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'class',
      'com.example.HostConnectionTest', '-e', 'aetherHostFixture', 'true',
      'com.aether.remote.test/androidx.test.runner.AndroidJUnitRunner'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    let finished = false;
    child.on('exit', () => { finished = true; });
    child.on('error', () => { finished = true; });
    const deadline = Date.now() + 120000;
    while (!finished && Date.now() < deadline) {
      await evaluateRenderer(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Подключить')?.click()`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(finished && /OK \(1 test\)/.test(output), 'Android host integration failed: ' + output.replace(/(?:pin|fingerprint|sessionToken)[^\n]*/gi, '[redacted]'));
    const downloads = await rendererValue("window.require('electron').ipcRenderer.invoke('get-download-folder')");
    for (let index = 0; index < 2; index++) {
      const file = path.join(downloads.path, `${prefix}-${index}.txt`);
      createdFiles.push(file);
      assert.equal(fs.readFileSync(file, 'utf8'), `Aether Android 2.0.0 transfer ${index}`);
    }
    console.log('Android-to-Electron TLS, approval, Deck sync, two file transfers and disconnect passed.');
  } finally {
    if (child && child.exitCode === null) child.kill();
    spawnSync(adb, ['-s', serial, 'shell', 'rm', '-f', '/data/local/tmp/aether-host-fixture.json'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
    for (const file of createdFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.unlinkSync(fixture);
    fs.rmdirSync(temporary);
  }
}

module.exports = { runAndroidClientSmoke };
