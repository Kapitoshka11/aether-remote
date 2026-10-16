const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDeckAssetStore } = require('../lib/aether-deck/assets.cjs');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-assets-'));
  const bytes = Buffer.from('89504e470d0a1a0a0102', 'hex');
  const source = path.join(root, 'image.png');
  fs.writeFileSync(source, bytes);
  const store = createDeckAssetStore({ directory: path.join(root, 'cache') });
  const original = fs.readFileSync;
  try {
    fs.readFileSync = () => { throw new Error('Blocking asset read'); };
    const asset = await store.importFile(source);
    assert.deepEqual((await store.read(asset.hash)).bytes, bytes);
    assert.equal((await store.importBytes({ hash: asset.hash, extension: '.png', bytes })).hash, asset.hash);
    assert.equal(await store.has(asset.hash), true);
    await assert.rejects(() => store.importBytes({ hash: '0'.repeat(64), extension: '.png', bytes }));
    await store.prune({});
    assert.equal(await store.has(asset.hash), false);
  } finally {
    fs.readFileSync = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('Asynchronous asset IO passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
