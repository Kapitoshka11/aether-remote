const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDeckStore } = require('../lib/aether-deck/store.cjs');
const { createProviderRegistry } = require('../lib/aether-deck/provider-registry.cjs');
const { createMacroEngine } = require('../lib/aether-deck/macro-engine.cjs');
const { createAetherDeckService } = require('../lib/aether-deck/service.cjs');
const { createDeckAssetStore } = require('../lib/aether-deck/assets.cjs');
const { exportDeckPackage, importDeckPackage } = require('../lib/aether-deck/package.cjs');
const { createNavigationProvider } = require('../lib/aether-deck/providers/navigation.cjs');

async function run() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-deck-service-'));
  try {
    const store = createDeckStore({ directory });
    await store.load();
    const document = store.getSnapshot();
    const page = document.decks[0].pages[0];
    page.controls.push({ id: 'launch', type: 'button', label: 'Launch', enabled: true, column: 0, row: 0, columnSpan: 1, rowSpan: 1, actions: [{ id: 'record', providerId: 'test', type: 'record', enabled: true, parameters: { value: 'launched' }, delayMs: 0, repeat: 1, condition: null, continueOnError: false }] });
    page.controls.push({ id: 'volume', type: 'slider', label: 'Volume', enabled: true, column: 1, row: 0, columnSpan: 1, rowSpan: 1, minimum: 0, maximum: 100, step: 1, actions: [{ id: 'volume-action', providerId: 'test', type: 'record', enabled: true, parameters: {}, delayMs: 0, repeat: 1, condition: null, continueOnError: false }] });
    page.controls.push({ id: 'navigate', type: 'button', label: 'Streaming', enabled: true, column: 2, row: 0, columnSpan: 1, rowSpan: 1, actions: [{ id: 'navigate-action', providerId: 'navigation', type: 'navigation.deck', enabled: true, parameters: { deckId: 'streaming' }, delayMs: 0, repeat: 1, condition: null, continueOnError: false }] });
    page.controls.push({ id: 'missing-folder', type: 'folder', label: 'Missing', enabled: true, column: 3, row: 0, columnSpan: 1, rowSpan: 1, targetPageId: 'deleted-page', actions: [] });
    document.decks.push({ id: 'streaming', name: 'Streaming', enabled: true, defaultPageId: 'streaming-main', autoSwitchEnabled: true, applicationRules: [{ processName: 'obs64.exe', priority: 10 }], pages: [{ id: 'streaming-main', name: 'OBS', columns: 4, background: '#08090b', backgroundAsset: null, parentPageId: null, controls: [] }] });
    await store.replace(document);
    const concurrentBase = store.getSnapshot();
    const [concurrentA, concurrentB] = await Promise.all([
      store.replace({ ...concurrentBase, name: 'A' }),
      store.replace({ ...concurrentBase, name: 'B' })
    ]);
    assert.equal(concurrentB.revision, concurrentA.revision + 1, 'concurrent replacements must receive distinct revisions');

    const calls = [];
    const registry = createProviderRegistry();
    registry.register({ id: 'test', actions: [], execute: async action => { calls.push(action.parameters.value); return { status: 'success' }; } });
    registry.register(createNavigationProvider());
    let service;
    const engine = createMacroEngine({ registry, publishState: (id, state) => service.publishControlState(id, state), delay: async () => {} });
    const clients = new Set();
    service = createAetherDeckService({ store, engine, registry, clients });
    const sent = [];
    const client = { isAuth: true, readyState: 1, sessionToken: 'trusted-phone', send: raw => sent.push(JSON.parse(raw)) };
    clients.add(client);
    await service.handleMessage(client, { action: 'DECK_SYNC_REQUEST' });
    assert.equal(sent[0].action, 'DECK_SNAPSHOT');
    assert.equal(sent[0].revision, store.getSnapshot().revision);

    await service.handleMessage(client, { action: 'DECK_TRIGGER', triggerId: 'stale', revision: 0, deckId: document.activeDeckId, pageId: page.id, controlId: 'launch' });
    assert.equal(sent.at(-1).status, 'STALE_REVISION');
    await service.handleMessage(client, { action: 'DECK_TRIGGER', triggerId: 'valid', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'launch' });
    assert.equal(calls[0], 'launched');
    assert.equal(sent.some(message => message.action === 'DECK_ACTION_RESULT' && message.status === 'success'), true);
    await service.handleMessage(client, { action: 'DECK_TRIGGER', triggerId: 'missing-target', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'missing-folder' });
    assert.equal(sent.at(-1).status, 'TARGET_UNAVAILABLE');
    await service.handleMessage(client, { action: 'DECK_TRIGGER', triggerId: 'navigate', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'navigate' });
    assert.equal(sent.some(message => message.action === 'DECK_NAVIGATION' && message.deckId === 'streaming'), true);
    clients.delete(client);
    const reconnectedClient = { isAuth: true, readyState: 1, sessionToken: 'trusted-phone', send: raw => sent.push(JSON.parse(raw)) };
    clients.add(reconnectedClient);
    await service.handleMessage(reconnectedClient, { action: 'DECK_SYNC_REQUEST' });
    assert.equal(sent.at(-1).activeDeckId, 'streaming', 'navigation must survive a WebSocket reconnect for the same session');
    clients.delete(reconnectedClient);
    clients.add(client);

    await service.handleMessage(client, { action: 'DECK_SLIDER', triggerId: 'slider-1', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'volume', value: 39, sequence: 1 });
    assert.equal(calls.at(-1), 39);
    await service.handleMessage(client, { action: 'DECK_SLIDER', triggerId: 'slider-invalid', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'volume', value: 'not-a-number', sequence: 2 });
    assert.equal(sent.at(-1).status, 'INVALID_VALUE');
    assert.equal(calls.at(-1), 39, 'invalid slider values must never reach a provider');
    await service.handleMessage(client, { action: 'DECK_SLIDER', triggerId: 'slider-step', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'volume', value: 41.6, sequence: 3 });
    assert.equal(calls.at(-1), 42, 'slider values must be aligned to the configured step');
    await service.handleMessage(client, { action: 'DECK_SLIDER', triggerId: 'slider-old', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'volume', value: 10, sequence: 0 });
    assert.equal(calls.at(-1), 42);
    clients.delete(client);
    clients.add(reconnectedClient);
    await service.handleMessage(reconnectedClient, { action: 'DECK_SYNC_REQUEST' });
    await service.handleMessage(reconnectedClient, { action: 'DECK_SLIDER', triggerId: 'slider-after-reconnect', revision: store.getSnapshot().revision, deckId: document.activeDeckId, pageId: page.id, controlId: 'volume', value: 55, sequence: 1 });
    assert.equal(calls.at(-1), 55, 'slider sequence must restart after reconnect sync');
    clients.delete(reconnectedClient);
    clients.add(client);

    service.publishVariables({ 'audio.volume': 39, 'media.track': 'Track' });
    const firstVariablePatch = sent.at(-1);
    assert.deepEqual(firstVariablePatch.variables, { 'audio.volume': 39, 'media.track': 'Track' });
    service.publishVariables({ 'audio.volume': 39 });
    assert.equal(sent.at(-1), firstVariablePatch, 'unchanged telemetry must not create another state patch');
    assert.equal(service.getSnapshot().document.variables.audio.volume, 39);
    assert.equal(service.handleForegroundApp({ processName: 'obs64.exe', windowTitle: 'OBS' }), true);
    assert.equal(sent.at(-1).action, 'DECK_NAVIGATION');
    assert.equal(sent.at(-1).deckId, 'streaming');

    service.publishControlState('volume', { value: 73 });
    await service.handleMessage(client, { action: 'DECK_NAVIGATE', deckId: 'streaming', pageId: 'streaming-main' });
    const editorDocument = store.getSnapshot();
    editorDocument.decks[0].name = 'Renamed';
    await service.applyEditorDocument(editorDocument);
    assert.equal(sent.at(-1).action, 'DECK_PATCH');
    assert.equal(sent.at(-1).document.activeDeckId, 'streaming');
    assert.equal(sent.at(-1).document.controlStates.volume.value, 73);

    const withoutStreaming = store.getSnapshot();
    withoutStreaming.decks = withoutStreaming.decks.filter(deck => deck.id !== 'streaming');
    withoutStreaming.activeDeckId = withoutStreaming.decks[0].id;
    withoutStreaming.activePageId = withoutStreaming.decks[0].defaultPageId;
    await service.applyEditorDocument(withoutStreaming);
    assert.equal(sent.at(-1).document.activeDeckId, withoutStreaming.activeDeckId, 'deleted session navigation must fall back to a valid deck');
    assert.equal(sent.at(-1).document.activePageId, withoutStreaming.activePageId, 'deleted session navigation must fall back to a valid page');
    assert.equal(service.revokeSession('trusted-phone'), true);

    const assetStore = createDeckAssetStore({ directory: path.join(directory, 'assets') });
    const pngPath = path.join(directory, 'icon.png');
    fs.writeFileSync(pngPath, Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex'));
    const asset = await assetStore.importFile(pngPath);
    assert.match(asset.hash, /^[a-f0-9]{64}$/);
    assert.equal(await assetStore.has(asset.hash), true);
    const assetService = createAetherDeckService({ store, engine, registry, clients, assetStore });
    await assetService.handleMessage(client, { action: 'DECK_ASSET_REQUEST', hash: '0'.repeat(64) });
    assert.deepEqual(sent.at(-1), {
      action: 'DECK_ASSET_ERROR', hash: '0'.repeat(64), status: 'NOT_FOUND', error: 'Aether Deck asset not found'
    });

    const exported = await exportDeckPackage({ document: store.getSnapshot(), assetStore, settings: { obsPassword: 'secret', sessionToken: 'hidden' } });
    assert.equal(exported.includes('secret'), false);
    assert.equal(exported.includes('hidden'), false);
    const imported = await importDeckPackage(exported, { assetStore });
    assert.equal(imported.document.schemaVersion, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log('Aether Deck service tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
