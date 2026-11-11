const path = require('node:path');
const { validateDocument } = require('./schema.cjs');

function collectAssetHashes(value, hashes = new Set()) {
  if (Array.isArray(value)) value.forEach(item => collectAssetHashes(item, hashes));
  else if (value && typeof value === 'object') {
    if (typeof value.hash === 'string' && /^[a-f0-9]{64}$/.test(value.hash)) hashes.add(value.hash);
    Object.values(value).forEach(item => collectAssetHashes(item, hashes));
  }
  return hashes;
}

async function exportDeckPackage({ document, assetStore }) {
  const validated = validateDocument(document);
  const assets = [];
  for (const hash of collectAssetHashes(validated)) {
    if (!await assetStore.has(hash)) continue;
    const asset = await assetStore.read(hash);
    assets.push({ hash, extension: path.extname(asset.path).toLowerCase(), mimeType: asset.mimeType, data: asset.bytes.toString('base64') });
  }
  return JSON.stringify({ packageType: 'aether-deck', packageVersion: 1, document: validated, assets }, null, 2);
}

async function importDeckPackage(text, { assetStore }) {
  const source = String(text || '');
  if (!source || source.length > 48 * 1024 * 1024) throw new Error('Aether Deck package size is invalid');
  const parsed = JSON.parse(source);
  if (parsed.packageType !== 'aether-deck' || parsed.packageVersion !== 1) throw new Error('Unsupported Aether Deck package');
  const document = validateDocument(parsed.document);
  const assets = Array.isArray(parsed.assets) ? parsed.assets : [];
  if (assets.length > 100) throw new Error('Aether Deck package contains too many assets');
  let totalAssetBytes = 0;
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object' || typeof asset.data !== 'string' || asset.data.length > 12 * 1024 * 1024) throw new Error('Aether Deck package contains an invalid asset');
    if (!/^[a-f0-9]{64}$/.test(String(asset.hash || '')) || asset.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new Error('Aether Deck package contains invalid asset encoding');
    const bytes = Buffer.from(asset.data, 'base64');
    totalAssetBytes += bytes.length;
    if (totalAssetBytes > 32 * 1024 * 1024) throw new Error('Aether Deck package assets exceed the total size limit');
    await assetStore.importBytes({ hash: asset.hash, extension: asset.extension, bytes });
  }
  return { document, assetCount: assets.length };
}

module.exports = { exportDeckPackage, importDeckPackage, collectAssetHashes };
