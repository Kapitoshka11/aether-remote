const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedRendererEvent } = require('../lib/ipc-security.cjs');

const entryPath = path.join('C:\\Program Files', 'Aether Remote', 'resources', 'app.asar', 'dist', 'index.html');
const mainFrame = { url: pathToFileURL(entryPath).href };
const webContents = { mainFrame };
const window = { isDestroyed: () => false, webContents };

assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: mainFrame }, window, entryPath), true);
assert.equal(isTrustedRendererEvent({ sender: {}, senderFrame: mainFrame }, window, entryPath), false);
assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: { url: 'https://evil.example/' } }, window, entryPath), false);
assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: { url: 'file:///C:/tmp/evil.html' } }, window, entryPath), false);
assert.equal(isTrustedRendererEvent({ sender: webContents, senderFrame: mainFrame }, { ...window, isDestroyed: () => true }, entryPath), false);
console.log('IPC security boundary tests passed.');
