import assert from 'node:assert/strict';
import { gridCellFromPointer } from '../src/aether-deck/gridModel.ts';

const rect = { left: 100, top: 50, width: 400, height: 300 };
assert.deepEqual(gridCellFromPointer(rect, 4, 3, 101, 51), { column: 0, row: 0 });
assert.deepEqual(gridCellFromPointer(rect, 4, 3, 299, 149), { column: 1, row: 0 });
assert.deepEqual(gridCellFromPointer(rect, 4, 3, 499, 349), { column: 3, row: 2 });
assert.deepEqual(gridCellFromPointer(rect, 4, 3, 700, 500), { column: 3, row: 2 });

console.log('Aether Deck grid model tests passed.');
