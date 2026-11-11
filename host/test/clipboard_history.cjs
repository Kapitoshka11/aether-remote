const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'protocol_schema.json'), 'utf8'));

assert.match(source, /action: 'CLIPBOARD_ITEM'/, 'Electron host must publish text clipboard changes');
assert.match(
  source,
  /client\.capabilities\?\.has\('clipboard-history-v1'\)/,
  'Unsolicited clipboard events must only reach clients that opted in'
);
assert.match(source, /CLIPBOARD_HISTORY_MAX_CHARS = 100_000/);
assert.match(source, /clipboardText\.length > CLIPBOARD_HISTORY_MAX_CHARS/);
assert.ok(schema.actions.CLIPBOARD_ITEM, 'Protocol schema must document CLIPBOARD_ITEM');
assert.ok(schema.actions.CLIPBOARD_WRITE_ACK, 'Protocol schema must distinguish clipboard write acknowledgements');
assert.match(source, /action: 'CLIPBOARD_WRITE_ACK'/);
assert.deepEqual(schema.actions.CLIPBOARD_ITEM.response.required, ['action', 'text', 'source', 'createdAt']);
assert.equal(schema.actions.CLIPBOARD_ITEM.response.properties.text.maxLength, 100000);

console.log('Clipboard history host contracts passed.');

const vm = require('node:vm');
const pollStart = source.indexOf('setInterval(() => {\n  if (!wss || !clipboardSharingEnabled');
assert.ok(pollStart >= 0);
const pollEnd = source.indexOf('}, 1500);', pollStart);
let reads = 0;
let busy = false;
const delivered = [];
const context = {
  wss: { clients: [
    { readyState: 1, isAuth: true, capabilities: new Set(['clipboard-history-v1']), send: value => delivered.push(JSON.parse(value)) },
    { readyState: 1, isAuth: false, capabilities: new Set(['clipboard-history-v1']), send: () => assert.fail('Unauthenticated client') },
    { readyState: 1, isAuth: true, capabilities: new Set(), send: () => assert.fail('Missing capability') }
  ] },
  clipboardSharingEnabled: false,
  windowsInput: { isClipboardBusy: () => busy },
  clipboard: { readText: () => { reads++; return 'user copied text'; } },
  clipboardFingerprint: value => value,
  lastClipboardFingerprint: '', CLIPBOARD_HISTORY_MAX_CHARS: 100000,
  WebSocket: { OPEN: 1 }
};
vm.createContext(context);
vm.runInContext('function poll() {' + source.slice(pollStart + 'setInterval(() => {'.length, pollEnd) + '}', context);
context.poll();
assert.equal(reads, 0, 'Disabled sharing must not even read clipboard');
context.clipboardSharingEnabled = true;
busy = true;
context.poll();
assert.equal(reads, 0, 'Temporary macro clipboard must not be read');
busy = false;
context.poll();
assert.equal(delivered.length, 1);
assert.equal(delivered[0].text, 'user copied text');
context.poll();
assert.equal(delivered.length, 1, 'Duplicate clipboard must not be published');
context.clipboardSharingEnabled = false;
context.poll();
assert.equal(delivered.length, 1, 'Disabling stops publication immediately');
console.log('Clipboard opt-in and macro race regressions passed.');
