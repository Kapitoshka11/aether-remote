const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createApplicationLauncher } = require('../lib/application-launcher.cjs');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-launcher-'));
  try {
    const executable = path.join(directory, 'Portable App.exe');
    const shortcut = path.join(directory, 'Portable App.lnk');
    fs.writeFileSync(executable, 'fixture');
    fs.writeFileSync(shortcut, 'fixture');
    const spawnCalls = [];
    const shellCalls = [];
    const launcher = createApplicationLauncher({
      spawnImpl: (file, args, options) => {
        const child = new EventEmitter();
        child.unref = () => { child.wasUnrefed = true; };
        spawnCalls.push({ file, args, options, child });
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
      shellOpenPath: async file => {
        shellCalls.push(file);
        return '';
      }
    });

    assert.deepEqual(await launcher.launch({ path: executable, arguments: ['--profile', 'work'], workingDirectory: directory }), { status: 'success' });
    assert.equal(spawnCalls.length, 1);
    assert.deepEqual({ ...spawnCalls[0], child: undefined }, {
      file: executable,
      args: ['--profile', 'work'],
      options: { cwd: directory, detached: true, stdio: 'ignore', windowsHide: false },
      child: undefined
    });
    assert.equal(spawnCalls[0].child.wasUnrefed, true);

    assert.deepEqual(await launcher.launch({ path: executable }), { status: 'success' });
    assert.deepEqual(spawnCalls[1].args, []);
    assert.equal(spawnCalls[1].child.wasUnrefed, true);

    assert.deepEqual(await launcher.launch({ path: shortcut }), { status: 'success' });
    assert.deepEqual(shellCalls, [shortcut]);
    await assert.rejects(() => launcher.launch({ path: path.join(directory, 'missing.exe'), arguments: [] }), /does not exist/);
    await assert.rejects(() => launcher.launch({ path: directory, arguments: [] }), /must be a file/);
    await assert.rejects(() => launcher.launch({ path: executable, arguments: '--unsafe' }), /array/);
    await assert.rejects(() => launcher.launch({ path: shortcut, arguments: ['--unsupported'] }), /Arguments are supported only/);
    await assert.rejects(() => launcher.launch({ path: executable, arguments: [], workingDirectory: executable }), /working directory/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('Application launcher tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
