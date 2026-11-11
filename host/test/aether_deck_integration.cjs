const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { selectDeckForApplication, createForegroundAppObserver } = require('../lib/aether-deck/foreground-app.cjs');

async function run() {
  const main = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
  assert.match(main, /publishVariables\(\{ 'stream\.screen': client\.isStreaming \}\)/, 'screen streaming Status variable is not published');
  const document = {
    decks: [
      { id: 'default', enabled: true, autoSwitchEnabled: false, applicationRules: [] },
      { id: 'browser', enabled: true, autoSwitchEnabled: true, applicationRules: [{ processName: 'chrome.exe', priority: 2 }] },
      { id: 'streaming', enabled: true, autoSwitchEnabled: true, applicationRules: [{ processName: 'obs64.exe', priority: 10 }] }
    ]
  };
  assert.equal(selectDeckForApplication(document, { processName: 'OBS64.EXE', windowTitle: 'OBS' }), 'streaming');
  assert.equal(selectDeckForApplication(document, { processName: 'notepad.exe' }), null);

  const published = [];
  const values = [{ processName: 'obs64.exe', windowTitle: 'OBS' }, { processName: 'obs64.exe', windowTitle: 'OBS' }, { processName: 'chrome.exe', windowTitle: 'Docs' }];
  const observer = createForegroundAppObserver({ readForeground: async () => values.shift() || null, publish: value => published.push(value), intervalMs: 5 });
  observer.start();
  await new Promise(resolve => setTimeout(resolve, 35));
  observer.stop();
  assert.deepEqual(published.map(item => item.processName), ['obs64.exe', 'chrome.exe']);
  let skippedReads = 0;
  const idleObserver = createForegroundAppObserver({ readForeground: async () => { skippedReads += 1; return null; }, publish: () => {}, shouldObserve: () => false, intervalMs: 5 });
  idleObserver.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  idleObserver.stop();
  assert.equal(skippedReads, 0);
  console.log('Aether Deck foreground integration tests passed.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
