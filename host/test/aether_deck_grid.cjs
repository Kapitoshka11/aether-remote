const assert = require('node:assert/strict');
const { placementStatus } = require('../lib/aether-deck/grid.cjs');

const page = {
  columns: 4,
  controls: [
    { id: 'wide', column: 0, row: 0, columnSpan: 2, rowSpan: 1 },
    { id: 'block', column: 2, row: 1, columnSpan: 1, rowSpan: 2 }
  ]
};

assert.deepEqual(placementStatus(page, 'wide', 2, 0), { valid: true, column: 2, row: 0 });
assert.deepEqual(placementStatus(page, 'wide', 1, 1), { valid: false, column: 1, row: 1 });
assert.deepEqual(placementStatus(page, 'wide', 3, 0), { valid: false, column: 3, row: 0 });
assert.deepEqual(placementStatus(page, 'wide', -1, 0), { valid: false, column: -1, row: 0 });

console.log('Aether Deck grid tests passed.');
