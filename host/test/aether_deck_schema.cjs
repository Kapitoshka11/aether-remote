const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDefaultDocument, validateDocument } = require('../lib/aether-deck/schema.cjs');
const { moveControl, resizeControl } = require('../lib/aether-deck/grid.cjs');
const { createDeckStore } = require('../lib/aether-deck/store.cjs');

async function run() {
  const document = validateDocument(createDefaultDocument());
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.decks.length, 1);
  assert.equal(document.decks[0].pages[0].columns, 4);

  const invalid = structuredClone(document);
  invalid.decks[0].pages[0].columns = 9;
  assert.throws(() => validateDocument(invalid), /columns/);

  const duplicateControls = structuredClone(document);
  duplicateControls.decks[0].pages.push({
    ...structuredClone(duplicateControls.decks[0].pages[0]),
    id: 'second-page',
    controls: [{ id: 'shared-control', type: 'button', label: '', enabled: true, column: 0, row: 0, columnSpan: 1, rowSpan: 1, actions: [] }]
  });
  duplicateControls.decks[0].pages[0].controls = [{ id: 'shared-control', type: 'button', label: '', enabled: true, column: 0, row: 0, columnSpan: 1, rowSpan: 1, actions: [] }];
  assert.throws(() => validateDocument(duplicateControls), /Duplicate control id/);

  const tooManyControls = structuredClone(document);
  tooManyControls.decks[0].pages[0].controls = Array.from({ length: 129 }, (_, index) => ({
    id: `control-${index}`, type: 'button', label: '', enabled: true, column: index % 4, row: Math.floor(index / 4), columnSpan: 1, rowSpan: 1, actions: []
  }));
  assert.throws(() => validateDocument(tooManyControls), /at most 128 items/);

  const page = structuredClone(document.decks[0].pages[0]);
  page.controls = [
    { id: 'one', type: 'button', label: 'One', enabled: true, column: 0, row: 0, columnSpan: 1, rowSpan: 1, actions: [] },
    { id: 'two', type: 'button', label: 'Two', enabled: true, column: 2, row: 0, columnSpan: 1, rowSpan: 1, actions: [] }
  ];
  const moved = moveControl(page, 'one', { column: 1, row: 0 });
  assert.equal(moved.controls.find(item => item.id === 'one').column, 1);
  assert.throws(() => resizeControl(moved, 'one', { columnSpan: 2, rowSpan: 1 }), /overlap/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-deck-store-'));
  try {
    const store = createDeckStore({ directory });
    await store.load();
    const initialRevision = store.getSnapshot().revision;
    const replacement = store.getSnapshot();
    replacement.decks[0].name = 'Streaming';
    await store.replace(replacement);
    assert.equal(store.getSnapshot().revision, initialRevision + 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'decks.json'), 'utf8')).decks[0].name, 'Streaming');

    fs.writeFileSync(path.join(directory, 'decks.json'), '{broken', 'utf8');
    const recovered = createDeckStore({ directory });
    await recovered.load();
    assert.equal(recovered.getSnapshot().decks[0].name, 'Aether Deck');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  console.log('Aether Deck schema tests passed.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
