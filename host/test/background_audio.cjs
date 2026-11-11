const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const createWindow = source.slice(source.indexOf('async function createWindow()'), source.indexOf("app.on('before-quit'"));

assert.match(createWindow, /webPreferences\s*:\s*\{[\s\S]*?backgroundThrottling\s*:\s*false/);
console.log('Background audio capture keeps renderer throttling disabled.');
