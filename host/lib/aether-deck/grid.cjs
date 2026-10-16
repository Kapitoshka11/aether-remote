const { validateDocument, rectanglesOverlap } = require('./schema.cjs');

function validatePageLayout(page) {
  const wrapper = {
    schemaVersion: 1,
    revision: 0,
    stateRevision: 0,
    activeDeckId: 'grid-deck',
    activePageId: page.id,
    decks: [{ id: 'grid-deck', name: 'Grid', enabled: true, defaultPageId: page.id, pages: [page] }]
  };
  return validateDocument(wrapper).decks[0].pages[0];
}

function updateControl(page, controlId, changes) {
  if (!page.controls.some(control => control.id === controlId)) throw new Error(`Unknown control: ${controlId}`);
  const next = structuredClone(page);
  const control = next.controls.find(item => item.id === controlId);
  Object.assign(control, changes);
  return validatePageLayout(next);
}

function moveControl(page, controlId, placement) {
  return updateControl(page, controlId, { column: placement.column, row: placement.row });
}

function resizeControl(page, controlId, span) {
  return updateControl(page, controlId, { columnSpan: span.columnSpan, rowSpan: span.rowSpan });
}

function firstFreePlacement(page, columnSpan = 1, rowSpan = 1) {
  for (let row = 0; row < 1000; row += 1) {
    for (let column = 0; column <= page.columns - columnSpan; column += 1) {
      const candidate = { column, row, columnSpan, rowSpan };
      if (!page.controls.some(control => rectanglesOverlap(candidate, control))) return { column, row };
    }
  }
  throw new Error('No free grid placement found');
}

function placementStatus(page, controlId, column, row) {
  const control = page.controls.find(item => item.id === controlId);
  if (!control) throw new Error(`Unknown control: ${controlId}`);
  const candidate = { column, row, columnSpan: control.columnSpan, rowSpan: control.rowSpan };
  const inside = column >= 0 && row >= 0 && column + control.columnSpan <= page.columns;
  const occupied = inside && page.controls.some(item => item.id !== controlId && rectanglesOverlap(candidate, item));
  return { valid: inside && !occupied, column, row };
}

module.exports = { moveControl, resizeControl, firstFreePlacement, placementStatus, validatePageLayout };
