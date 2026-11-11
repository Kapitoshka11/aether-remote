const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDeckAssetStore } = require('../lib/aether-deck/assets.cjs');
const { selectDeckAsset } = require('../lib/aether-deck/asset-selection.cjs');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-deck-asset-selection-'));
  try {
    const pngPath = path.join(directory, 'button.png');
    const pngBytes = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
    fs.writeFileSync(pngPath, pngBytes);
    const assetStore = createDeckAssetStore({ directory: path.join(directory, 'assets') });

    const selected = await selectDeckAsset({
      showOpenDialog: async () => ({ canceled: false, filePaths: [pngPath] }),
      assetStore
    });

    assert.equal(selected.canceled, false);
    assert.equal(selected.asset.mimeType, 'image/png');
    assert.equal(selected.asset.fileName, 'button.png');
    assert.equal(selected.asset.size, pngBytes.length);
    assert.match(selected.asset.hash, /^[a-f0-9]{64}$/);
    assert.equal('path' in selected.asset, false, 'renderer must not receive the private asset path');

    const canceled = await selectDeckAsset({
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      assetStore
    });
    assert.deepEqual(canceled, { canceled: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('Aether Deck asset selection tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
