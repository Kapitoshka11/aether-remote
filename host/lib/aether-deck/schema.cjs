const crypto = require('node:crypto');

const SCHEMA_VERSION = 1;
const CONTROL_TYPES = new Set(['button', 'toggle', 'slider', 'folder', 'status']);
const MAX_DECKS = 32;
const MAX_PAGES_PER_DECK = 64;
const MAX_CONTROLS_PER_PAGE = 128;
const MAX_ACTIONS_PER_CONTROL = 16;

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createDefaultDocument() {
  const pageId = id('page');
  const deckId = id('deck');
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    stateRevision: 0,
    activeDeckId: deckId,
    activePageId: pageId,
    autoSwitchEnabled: false,
    variables: {},
    controlStates: {},
    decks: [{
      id: deckId,
      name: 'Aether Deck',
      enabled: true,
      defaultPageId: pageId,
      autoSwitchEnabled: false,
      applicationRules: [],
      pages: [{
        id: pageId,
        name: 'Главная',
        columns: 4,
        background: '#08090b',
        backgroundAsset: null,
        parentPageId: null,
        controls: []
      }]
    }]
  };
}

function expectObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value;
}

function expectString(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function integer(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be between ${min} and ${max}`);
  return value;
}

function normalizeAction(raw, index) {
  const action = expectObject(raw, `action ${index}`);
  return {
    id: typeof action.id === 'string' && action.id ? action.id : id('action'),
    providerId: expectString(action.providerId, 'providerId', 80),
    type: expectString(action.type, 'action type', 120),
    enabled: action.enabled !== false,
    parameters: action.parameters && typeof action.parameters === 'object' && !Array.isArray(action.parameters) ? structuredClone(action.parameters) : {},
    delayMs: integer(action.delayMs ?? 0, 'delayMs', 0, 3600000),
    repeat: integer(action.repeat ?? 1, 'repeat', 1, 100),
    condition: action.condition && typeof action.condition === 'object' ? structuredClone(action.condition) : null,
    continueOnError: action.continueOnError === true
  };
}

function boundedArray(value, field, maximum) {
  if (!Array.isArray(value)) return [];
  if (value.length > maximum) throw new Error(`${field} must contain at most ${maximum} items`);
  return value;
}

function normalizeControl(raw, columns, index) {
  const control = expectObject(raw, `control ${index}`);
  if (!CONTROL_TYPES.has(control.type)) throw new Error(`Unsupported control type: ${control.type}`);
  const normalized = {
    id: expectString(control.id, 'control id', 120),
    type: control.type,
    label: typeof control.label === 'string' ? control.label.slice(0, 160) : '',
    enabled: control.enabled !== false,
    column: integer(control.column ?? 0, 'column', 0, columns - 1),
    row: integer(control.row ?? 0, 'row', 0, 63),
    columnSpan: integer(control.columnSpan ?? 1, 'columnSpan', 1, columns),
    rowSpan: integer(control.rowSpan ?? 1, 'rowSpan', 1, 16),
    icon: control.icon && typeof control.icon === 'object' ? structuredClone(control.icon) : null,
    background: typeof control.background === 'string' ? control.background.slice(0, 64) : '#16191f',
    foreground: typeof control.foreground === 'string' ? control.foreground.slice(0, 64) : '#ffffff',
    stateBinding: typeof control.stateBinding === 'string' ? control.stateBinding.slice(0, 160) : null,
    actions: boundedArray(control.actions, 'actions', MAX_ACTIONS_PER_CONTROL).map(normalizeAction)
  };
  if (normalized.column + normalized.columnSpan > columns) throw new Error('Control span exceeds page columns');
  if (control.type === 'toggle') normalized.actionsB = boundedArray(control.actionsB, 'actionsB', MAX_ACTIONS_PER_CONTROL).map(normalizeAction);
  if (control.type === 'slider') {
    normalized.minimum = Number.isFinite(Number(control.minimum)) ? Number(control.minimum) : 0;
    normalized.maximum = Number.isFinite(Number(control.maximum)) ? Number(control.maximum) : 100;
    normalized.step = Number.isFinite(Number(control.step)) && Number(control.step) > 0 ? Number(control.step) : 1;
    if (normalized.maximum <= normalized.minimum) throw new Error('Slider maximum must exceed minimum');
  }
  if (control.type === 'folder') normalized.targetPageId = expectString(control.targetPageId, 'targetPageId', 120);
  return normalized;
}

function rectanglesOverlap(a, b) {
  return a.column < b.column + b.columnSpan && a.column + a.columnSpan > b.column && a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
}

function validatePage(raw, index, globalControlIds) {
  const page = expectObject(raw, `page ${index}`);
  const columns = integer(page.columns, 'columns', 3, 8);
  const controls = boundedArray(page.controls, 'page controls', MAX_CONTROLS_PER_PAGE).map((item, controlIndex) => normalizeControl(item, columns, controlIndex));
  const controlIds = new Set();
  for (const control of controls) {
    if (controlIds.has(control.id)) throw new Error(`Duplicate control id: ${control.id}`);
    controlIds.add(control.id);
    if (globalControlIds.has(control.id)) throw new Error(`Duplicate control id across document: ${control.id}`);
    globalControlIds.add(control.id);
  }
  for (let left = 0; left < controls.length; left += 1) {
    for (let right = left + 1; right < controls.length; right += 1) {
      if (rectanglesOverlap(controls[left], controls[right])) throw new Error(`Controls overlap: ${controls[left].id} and ${controls[right].id}`);
    }
  }
  return {
    id: expectString(page.id, 'page id', 120),
    name: expectString(page.name, 'page name', 120),
    columns,
    background: typeof page.background === 'string' ? page.background.slice(0, 64) : '#08090b',
    backgroundAsset: typeof page.backgroundAsset === 'string' ? page.backgroundAsset : null,
    parentPageId: typeof page.parentPageId === 'string' ? page.parentPageId : null,
    controls
  };
}

function validateDeck(raw, index, globalControlIds) {
  const deck = expectObject(raw, `deck ${index}`);
  const pages = boundedArray(deck.pages, 'deck pages', MAX_PAGES_PER_DECK).map((page, pageIndex) => validatePage(page, pageIndex, globalControlIds));
  if (!pages.length) throw new Error('Deck must contain at least one page');
  const pageIds = new Set(pages.map(page => page.id));
  if (pageIds.size !== pages.length) throw new Error('Duplicate page id');
  const defaultPageId = typeof deck.defaultPageId === 'string' && pageIds.has(deck.defaultPageId) ? deck.defaultPageId : pages[0].id;
  return {
    id: expectString(deck.id, 'deck id', 120),
    name: expectString(deck.name, 'deck name', 120),
    enabled: deck.enabled !== false,
    defaultPageId,
    autoSwitchEnabled: deck.autoSwitchEnabled === true,
    applicationRules: Array.isArray(deck.applicationRules) ? structuredClone(deck.applicationRules).slice(0, 100) : [],
    pages
  };
}

function validateDocument(input) {
  const document = expectObject(input, 'document');
  if (document.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schemaVersion: ${document.schemaVersion}`);
  const globalControlIds = new Set();
  const decks = boundedArray(document.decks, 'document decks', MAX_DECKS).map((deck, deckIndex) => validateDeck(deck, deckIndex, globalControlIds));
  if (!decks.length) throw new Error('Document must contain at least one deck');
  const deckIds = new Set(decks.map(deck => deck.id));
  if (deckIds.size !== decks.length) throw new Error('Duplicate deck id');
  const activeDeckId = typeof document.activeDeckId === 'string' && deckIds.has(document.activeDeckId) ? document.activeDeckId : decks[0].id;
  const activeDeck = decks.find(deck => deck.id === activeDeckId);
  const activePageId = typeof document.activePageId === 'string' && activeDeck.pages.some(page => page.id === document.activePageId)
    ? document.activePageId
    : activeDeck.defaultPageId;
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: integer(document.revision ?? 0, 'revision', 0, Number.MAX_SAFE_INTEGER),
    stateRevision: integer(document.stateRevision ?? 0, 'stateRevision', 0, Number.MAX_SAFE_INTEGER),
    activeDeckId,
    activePageId,
    autoSwitchEnabled: document.autoSwitchEnabled === true,
    variables: document.variables && typeof document.variables === 'object' && !Array.isArray(document.variables) ? structuredClone(document.variables) : {},
    controlStates: document.controlStates && typeof document.controlStates === 'object' && !Array.isArray(document.controlStates) ? structuredClone(document.controlStates) : {},
    decks
  };
}

function validatePatch(input) {
  const patch = expectObject(input, 'patch');
  return {
    baseRevision: integer(patch.baseRevision, 'baseRevision', 0, Number.MAX_SAFE_INTEGER),
    document: validateDocument(patch.document)
  };
}

module.exports = { SCHEMA_VERSION, CONTROL_TYPES, createDefaultDocument, validateDocument, validatePatch, rectanglesOverlap };
