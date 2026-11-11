const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPowerShellLineWorker } = require('../lib/powershell-line-worker.cjs');

const stdout = new EventEmitter();
const stdin = { destroyed: false, write() {}, end() {} };
const child = Object.assign(new EventEmitter(), { stdout, stdin, killed: false, kill() { this.killed = true; } });
const worker = createPowerShellLineWorker({
  script: '',
  spawnImpl: () => child,
  timeoutMs: 1000,
  failureMessage: 'worker failed'
});

async function run() {
  const first = worker.request({ id: 1 });
  const second = worker.request({ id: 2 });
  stdout.emit('data', Buffer.from('PowerShell warning that is not JSON\n{"id":1}\n{"id":2}\n'));
  assert.deepEqual(await first, { id: 1 });
  assert.deepEqual(await second, { id: 2 });
  worker.close();
  console.log('PowerShell line worker tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
