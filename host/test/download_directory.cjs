const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDownloadDirectoryStore, isPathInsideDirectory } = require('../lib/download-directory.cjs');

assert.equal(isPathInsideDirectory('C:\\Users\\Admin\\Downloads\\file.txt', 'c:\\users\\admin\\downloads', 'win32'), true);
assert.equal(isPathInsideDirectory('C:\\Users\\Admin\\Downloads-hack\\file.txt', 'C:\\Users\\Admin\\Downloads', 'win32'), false);
assert.equal(isPathInsideDirectory('../outside.txt', process.cwd()), false);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-downloads-'));
try {
  const fallbackPath = path.join(root, 'fallback');
  const selectedPath = path.join(root, 'selected');
  const settingsPath = path.join(root, 'settings.json');
  const store = createDownloadDirectoryStore({ settingsPath, fallbackPath, fs });
  assert.equal(store.get(), fallbackPath);
  assert.equal(store.set(selectedPath), selectedPath);
  assert.equal(JSON.parse(fs.readFileSync(settingsPath, 'utf8')).downloadDirectory, selectedPath);
  fs.writeFileSync(path.join(selectedPath, 'photo.png'), 'first');
  assert.equal(store.createUniquePath('photo.png'), path.join(selectedPath, 'photo (1).png'));
  fs.rmSync(selectedPath, { recursive: true, force: true });
  fs.writeFileSync(selectedPath, 'not a directory');
  assert.equal(store.get(), fallbackPath, 'invalid saved directory must fall back safely');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Download directory tests passed.');
