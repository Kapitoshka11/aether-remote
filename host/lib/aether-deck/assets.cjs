const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function hasExpectedSignature(extension, bytes) {
  if (extension === '.png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === '.gif') return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
  if (extension === '.webp') return bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function createDeckAssetStore({ directory, maxBytes = 8 * 1024 * 1024 }) {
  async function ready() { await fs.promises.mkdir(directory, { recursive: true }); }

  async function save(destination, bytes) {
    await ready();
    try { await fs.promises.writeFile(destination, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }

  async function importFile(sourcePath) {
    const extension = path.extname(sourcePath).toLowerCase();
    if (!EXTENSIONS.has(extension)) throw new Error('Unsupported Aether Deck asset type');
    const size = (await fs.promises.stat(sourcePath)).size;
    if (!size || size > maxBytes) throw new Error('Aether Deck asset size is invalid');
    const bytes = await fs.promises.readFile(sourcePath);
    if (!bytes.length || bytes.length > maxBytes) throw new Error('Aether Deck asset size is invalid');
    if (!hasExpectedSignature(extension, bytes)) throw new Error('Aether Deck asset content does not match its extension');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const destination = path.join(directory, `${hash}${extension === '.jpeg' ? '.jpg' : extension}`);
    await save(destination, bytes);
    return { hash, mimeType: MIME[extension], size: bytes.length, fileName: path.basename(sourcePath), path: destination };
  }

  async function find(hash) {
    if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) return null;
    await ready();
    const name = (await fs.promises.readdir(directory)).find(file => file.startsWith(`${hash}.`) && EXTENSIONS.has(path.extname(file)));
    if (!name) return null;
    const filePath = path.join(directory, name);
    const extension = path.extname(name).toLowerCase();
    return { hash, mimeType: MIME[extension] || 'application/octet-stream', size: (await fs.promises.stat(filePath)).size, fileName: name, path: filePath };
  }

  async function has(hash) { return (await find(hash)) !== null; }
  async function read(hash) {
    const asset = await find(hash);
    if (!asset) throw new Error('Aether Deck asset not found');
    return { ...asset, bytes: await fs.promises.readFile(asset.path) };
  }
  async function importBytes({ hash, extension, bytes }) {
    const normalizedExtension = String(extension || '').toLowerCase();
    if (!EXTENSIONS.has(normalizedExtension)) throw new Error('Unsupported imported asset type');
    const buffer = Buffer.from(bytes);
    if (!buffer.length || buffer.length > maxBytes) throw new Error('Imported asset size is invalid');
    if (!hasExpectedSignature(normalizedExtension, buffer)) throw new Error('Imported asset content does not match its extension');
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (hash && actualHash !== hash) throw new Error('Imported asset hash mismatch');
    const destination = path.join(directory, `${actualHash}${normalizedExtension}`);
    await save(destination, buffer);
    return await find(actualHash);
  }
  async function prune(document) {
    await ready();
    const referenced = new Set();
    const visit = value => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          if ((key === 'hash' || key === 'backgroundAsset') && typeof child === 'string' && /^[a-f0-9]{64}$/.test(child)) referenced.add(child);
          visit(child);
        }
      }
    };
    visit(document);
    let removed = 0;
    for (const name of await fs.promises.readdir(directory)) {
      const match = /^([a-f0-9]{64})\.[a-z0-9]+$/i.exec(name);
      if (match && !referenced.has(match[1].toLowerCase())) {
        await fs.promises.unlink(path.join(directory, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        removed += 1;
      }
    }
    return removed;
  }
  return { importFile, importBytes, has, find, read, prune, directory };
}

module.exports = { createDeckAssetStore, DECK_ASSET_EXTENSIONS: EXTENSIONS, hasExpectedSignature };
