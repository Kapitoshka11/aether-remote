const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createIncomingFileTransfers } = require('../lib/incoming-file-transfers.cjs');

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-transfer-'));
  const sent = [], completed = [], transfers = new Map();
  const ws = { readyState: 1, isAuth: true, send: raw => sent.push(JSON.parse(raw)), close() { this.readyState = 3; } };
  let name = 0, releaseWrite, writing;
  let waitForWrite = new Promise(resolve => { writing = resolve; });
  let blocked = false, busyUnlinks = 0;
  const receiver = createIncomingFileTransfers({ transfers, createPath: () => path.join(root, `${++name}.bin`),
    sanitizeName: value => value, decodeChunk: value => Buffer.from(value, 'base64'), notify: value => completed.push(value),
    io: { ...fs, async open(...args) {
      const handle = await fs.open(...args);
      return { close: () => handle.close(), sync: () => handle.sync(), async write(buffer, offset, length, position) {
        if (blocked) { writing(); await new Promise(resolve => { releaseWrite = resolve; }); blocked = false; }
        return handle.write(buffer, offset, Math.min(length, 2), position);
      } };
    }, async unlink(file) {
      if (busyUnlinks++ === 0) throw Object.assign(new Error('Busy'), { code: 'EBUSY' });
      return fs.unlink(file);
    } }
  });
  const start = id => receiver.handle(ws, { action: 'FILE_START', fileId: id, fileName: 'same.bin', fileSize: 4, chunkSize: 4 });
  const chunk = (id, offset = 0) => receiver.handle(ws, { action: 'FILE_CHUNK', fileId: id, offset, data: Buffer.from('data').toString('base64') });
  try {
    for (const id of ['one', 'two']) {
      await start(id);
      await start(id);
      assert.equal(sent.at(-1).status, 'ERROR');
      await Promise.all([chunk(id), receiver.handle(ws, { action: 'FILE_END', fileId: id })]);
      assert.equal(sent.at(-1).status, 'SUCCESS');
      assert.equal(await fs.readFile(completed.at(-1).filePath, 'utf8'), 'data');
    }
    assert.equal(completed.length, 2);
    assert.notEqual(completed[0].filePath, completed[1].filePath);
    await start('bad');
    await chunk('bad', 1);
    assert.equal(sent.at(-1).status, 'ERROR');
    assert.equal(transfers.size, 0);
    assert.ok(busyUnlinks >= 2);
    await start('cancel');
    const partial = transfers.get('cancel').filePath;
    blocked = true;
    const write = chunk('cancel');
    await waitForWrite;
    let ticked = false;
    await new Promise(resolve => setImmediate(() => { ticked = true; resolve(); }));
    assert.equal(ticked, true);
    const before = sent.length;
    ws.readyState = 3;
    const cancel = receiver.abort('cancel');
    releaseWrite();
    await Promise.all([write, cancel]);
    assert.equal(sent.length, before);
    await assert.rejects(fs.stat(partial), { code: 'ENOENT' });
    assert.equal(transfers.size, 0);

    const quotaTransfers = new Map();
    const quotaSent = [];
    const quotaReceiver = createIncomingFileTransfers({
      transfers: quotaTransfers,
      createPath: value => path.join(root, `quota-${value}`),
      sanitizeName: value => value,
      decodeChunk: value => Buffer.from(value, 'base64'),
      maxActiveTransfers: 2,
      maxTotalReservedBytes: 6,
      minimumFreeBytes: 0,
      io: fs
    });
    const firstSocket = { readyState: 1, isAuth: true, send: raw => quotaSent.push(JSON.parse(raw)), close() {} };
    const secondSocket = { readyState: 1, isAuth: true, send: raw => quotaSent.push(JSON.parse(raw)), close() {} };
    await quotaReceiver.handle(firstSocket, { action: 'FILE_START', fileId: 'quota-one', fileName: 'one.bin', fileSize: 4 });
    await quotaReceiver.handle(secondSocket, { action: 'FILE_START', fileId: 'quota-two', fileName: 'two.bin', fileSize: 4 });
    assert.equal(quotaSent.at(-1).status, 'ERROR');
    assert.equal(quotaTransfers.size, 1);
    await quotaReceiver.abort('quota-one');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  console.log('Incoming files: repeated files, duplicates, partial writes, ordering, disk contention and cancellation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
