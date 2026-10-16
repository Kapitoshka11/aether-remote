const { isDeepStrictEqual } = require('node:util');
const { selectDeckForApplication } = require('./foreground-app.cjs');

function createAetherDeckService({ store, engine, registry, clients, assetStore = null }) {
  let stateRevision = store.getSnapshot().stateRevision || 0;
  const controlStates = structuredClone(store.getSnapshot().controlStates || {});
  const runtimeVariables = {};
  const sessionStates = new Map();
  const anonymousSessionStates = new WeakMap();
  const sliderExecutionQueues = new Map();
  let sliderServerSequence = 0;
  let activeDeckId = store.getSnapshot().activeDeckId;
  let activePageId = store.getSnapshot().activePageId;

  function canSend(client) {
    return client && client.isAuth === true && (client.readyState === undefined || client.readyState === 1);
  }
  function send(client, message) {
    if (canSend(client)) client.send(JSON.stringify(message));
  }
  function broadcast(message) {
    for (const client of clients || []) send(client, message);
  }
  function clientSession(client) {
    const token = typeof client?.sessionToken === 'string' && client.sessionToken ? client.sessionToken : null;
    if (token) {
      if (!sessionStates.has(token)) sessionStates.set(token, { navigation: null, history: [], sliderSequences: new Map() });
      return sessionStates.get(token);
    }
    if (!anonymousSessionStates.has(client)) anonymousSessionStates.set(client, { navigation: null, history: [], sliderSequences: new Map() });
    return anonymousSessionStates.get(client);
  }
  function validNavigation(document, navigation) {
    const fallbackDeck = document.decks.find(item => item.id === activeDeckId) || document.decks.find(item => item.id === document.activeDeckId) || document.decks[0];
    const requestedDeck = document.decks.find(item => item.id === navigation?.deckId);
    const deck = requestedDeck || fallbackDeck;
    const requestedPage = deck?.pages.find(item => item.id === navigation?.pageId);
    const page = requestedPage || deck?.pages.find(item => item.id === (requestedDeck ? navigation?.pageId : activePageId)) || deck?.pages.find(item => item.id === deck.defaultPageId) || deck?.pages[0];
    return { deckId: deck.id, pageId: page.id };
  }
  function snapshotMessage(client = null) {
    const document = store.getSnapshot();
    const session = client ? clientSession(client) : null;
    const navigation = validNavigation(document, session?.navigation);
    if (session) session.navigation = navigation;
    const clientDeckId = navigation.deckId;
    const clientPageId = navigation.pageId;
    return { action: 'DECK_SNAPSHOT', revision: document.revision, stateRevision, activeDeckId: clientDeckId, activePageId: clientPageId, document: { ...document, activeDeckId: clientDeckId, activePageId: clientPageId, controlStates: structuredClone(controlStates), variables: { ...document.variables, ...structuredClone(runtimeVariables) } }, providers: registry.describe() };
  }
  function locateControl(message) {
    const document = store.getSnapshot();
    if (Number(message.revision) !== document.revision) return { error: 'STALE_REVISION', document };
    const deck = document.decks.find(item => item.id === message.deckId);
    const page = deck?.pages.find(item => item.id === message.pageId);
    const control = page?.controls.find(item => item.id === message.controlId);
    if (!deck || !page || !control) return { error: 'CONTROL_NOT_FOUND', document };
    return { document, deck, page, control };
  }
  function variables(client) {
    const document = store.getSnapshot();
    const navigation = validNavigation(document, client ? clientSession(client).navigation : null);
    return { ...document.variables, ...structuredClone(runtimeVariables), deck: { activeDeckId: navigation.deckId, activePageId: navigation.pageId }, controls: structuredClone(controlStates) };
  }
  function publishControlState(controlId, patch) {
    controlStates[controlId] = { ...(controlStates[controlId] || {}), ...structuredClone(patch) };
    stateRevision += 1;
    broadcast({ action: 'DECK_STATE_PATCH', stateRevision, states: { [controlId]: controlStates[controlId] } });
  }
  function publishVariables(patch) {
    const changed = {};
    for (const [path, value] of Object.entries(patch || {})) {
      const parts = path.split('.').filter(Boolean);
      let target = runtimeVariables;
      for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]] ||= {};
      if (parts.length && !isDeepStrictEqual(target[parts.at(-1)], value)) {
        target[parts.at(-1)] = structuredClone(value);
        changed[path] = value;
      }
    }
    if (Object.keys(changed).length === 0) return;
    stateRevision += 1;
    broadcast({ action: 'DECK_STATE_PATCH', stateRevision, variables: structuredClone(changed) });
  }
  function navigateClient(client, target) {
    const document = store.getSnapshot();
    const session = clientSession(client);
    const current = session.navigation || { deckId: activeDeckId, pageId: activePageId };
    let next = null;
    if (target.back === true) next = session.history.pop() || current;
    else {
      const deck = target.deckId ? document.decks.find(item => item.id === target.deckId) : document.decks.find(item => item.id === current.deckId);
      const pageId = target.pageId || deck?.defaultPageId;
      const page = deck?.pages.find(item => item.id === pageId);
      if (!deck || !page) throw new Error('Navigation target is unavailable');
      next = { deckId: deck.id, pageId: page.id };
      if (next.deckId !== current.deckId || next.pageId !== current.pageId) {
        session.history.push(current);
        if (session.history.length > 50) session.history.shift();
      }
    }
    session.navigation = next;
    send(client, { action: 'DECK_NAVIGATION', ...next });
    return next;
  }
  async function execute(client, message, control, valueOverride) {
    const executionControl = structuredClone(control);
    if (valueOverride !== undefined) {
      executionControl.type = 'button';
      executionControl.actions = executionControl.actions.map(action => ({ ...action, parameters: { ...action.parameters, value: valueOverride } }));
    }
    send(client, { action: 'DECK_ACTION_RESULT', triggerId: message.triggerId, controlId: control.id, status: 'running' });
    const result = await engine.executeControl(executionControl, { variables: variables(client), triggerId: String(message.triggerId || ''), client, navigate: target => navigateClient(client, target) });
    send(client, { action: 'DECK_ACTION_RESULT', triggerId: message.triggerId, controlId: control.id, ...result });
  }
  async function handleMessage(client, message) {
    if (!client || client.isAuth !== true) return false;
    if (message.action === 'DECK_SYNC_REQUEST') {
      clientSession(client).sliderSequences.clear();
      send(client, snapshotMessage(client));
      return true;
    }
    if (message.action === 'DECK_TRIGGER') {
      const located = locateControl(message);
      if (located.error) send(client, { action: 'DECK_ACTION_RESULT', triggerId: message.triggerId, controlId: message.controlId, status: located.error, revision: located.document.revision });
      else if (located.control.type === 'folder') {
        try {
          navigateClient(client, { pageId: located.control.targetPageId });
        } catch (_) {
          send(client, {
            action: 'DECK_ACTION_RESULT',
            triggerId: message.triggerId,
            controlId: located.control.id,
            status: 'TARGET_UNAVAILABLE',
            revision: located.document.revision
          });
        }
      } else await execute(client, message, located.control);
      return true;
    }
    if (message.action === 'DECK_SLIDER') {
      const located = locateControl(message);
      if (located.error) {
        send(client, { action: 'DECK_ACTION_RESULT', triggerId: message.triggerId, controlId: message.controlId, status: located.error, revision: located.document.revision });
        return true;
      }
      if (located.control.type !== 'slider') return true;
      const sequences = clientSession(client).sliderSequences;
      const sequence = Number(message.sequence);
      const rawValue = Number(message.value);
      if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(rawValue)) {
        send(client, { action: 'DECK_ACTION_RESULT', triggerId: message.triggerId, controlId: located.control.id, status: 'INVALID_VALUE', revision: located.document.revision });
        return true;
      }
      if (sequence <= (sequences.get(located.control.id) ?? -1)) return true;
      sequences.set(located.control.id, sequence);
      const clamped = Math.max(located.control.minimum, Math.min(located.control.maximum, rawValue));
      const numeric = Math.max(located.control.minimum, Math.min(located.control.maximum,
        Number((located.control.minimum + Math.round((clamped - located.control.minimum) / located.control.step) * located.control.step).toPrecision(12))));
      const previous = sliderExecutionQueues.get(located.control.id) || Promise.resolve();
      const operation = previous.catch(() => {}).then(async () => {
        sliderServerSequence += 1;
        publishControlState(located.control.id, { value: numeric, sequence: sliderServerSequence });
        await execute(client, message, located.control, numeric);
      });
      sliderExecutionQueues.set(located.control.id, operation);
      try {
        await operation;
      } finally {
        if (sliderExecutionQueues.get(located.control.id) === operation) sliderExecutionQueues.delete(located.control.id);
      }
      return true;
    }
    if (message.action === 'DECK_NAVIGATE') {
      try { navigateClient(client, { deckId: message.deckId, pageId: message.pageId }); } catch (_) {}
      return true;
    }
    if (message.action === 'DECK_ASSET_REQUEST' && assetStore) {
      const requestedHash = String(message.hash || '');
      let asset;
      try {
        asset = await assetStore.read(requestedHash);
      } catch (error) {
        send(client, { action: 'DECK_ASSET_ERROR', hash: requestedHash, status: 'NOT_FOUND', error: error.message || 'Aether Deck asset not found' });
        return true;
      }
      const chunkSize = 48 * 1024;
      const chunks = Math.ceil(asset.bytes.length / chunkSize);
      for (let index = 0; index < chunks; index += 1) {
        send(client, { action: 'DECK_ASSET_CHUNK', hash: asset.hash, mimeType: asset.mimeType, index, chunks, data: asset.bytes.subarray(index * chunkSize, Math.min(asset.bytes.length, (index + 1) * chunkSize)).toString('base64') });
      }
      return true;
    }
    return false;
  }
  async function applyEditorDocument(input) {
    const before = store.getSnapshot().revision;
    const document = await store.replace(input);
    if (!document.decks.some(deck => deck.id === activeDeckId)) {
      activeDeckId = document.activeDeckId;
      activePageId = document.activePageId;
    }
    for (const client of clients || []) {
      const session = clientSession(client);
      const navigation = validNavigation(document, session.navigation);
      session.navigation = navigation;
      session.history = session.history.filter(item => validNavigation(document, item).deckId === item.deckId && validNavigation(document, item).pageId === item.pageId);
      const clientDeckId = navigation.deckId;
      const clientPageId = navigation.pageId;
      send(client, {
        action: 'DECK_PATCH',
        fromRevision: before,
        toRevision: document.revision,
        document: {
          ...document,
          activeDeckId: clientDeckId,
          activePageId: clientPageId,
          controlStates: structuredClone(controlStates),
          variables: { ...document.variables, ...structuredClone(runtimeVariables) }
        }
      });
    }
    await assetStore?.prune?.(document);
    return document;
  }
  function updateNavigation(activeDeckId, activePageId) {
    const document = store.getSnapshot();
    const deck = document.decks.find(item => item.id === activeDeckId);
    const page = deck?.pages.find(item => item.id === activePageId);
    if (!deck || !page) return false;
    const next = { deckId: deck.id, pageId: page.id };
    for (const client of clients || []) {
      const session = clientSession(client);
      session.navigation = next;
      session.history = [];
    }
    broadcast({ action: 'DECK_NAVIGATION', ...next });
    return true;
  }
  function handleForegroundApp(application) {
    publishVariables({ 'application.processName': application.processName || '', 'application.executablePath': application.executablePath || '', 'application.windowTitle': application.windowTitle || '' });
    const document = store.getSnapshot();
    const deckId = selectDeckForApplication(document, application);
    if (!deckId || deckId === activeDeckId) return false;
    const deck = document.decks.find(item => item.id === deckId);
    activeDeckId = deck.id;
    activePageId = deck.defaultPageId;
    return updateNavigation(activeDeckId, activePageId);
  }
  function revokeSession(sessionToken) {
    return sessionStates.delete(String(sessionToken || ''));
  }
  return { handleMessage, applyEditorDocument, publishControlState, publishVariables, updateNavigation, handleForegroundApp, revokeSession, getSnapshot: snapshotMessage };
}

module.exports = { createAetherDeckService };
