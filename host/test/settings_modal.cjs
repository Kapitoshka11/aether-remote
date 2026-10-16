const assert = require('node:assert/strict');

const { lockDocumentScroll } = require('../lib/ui/scroll-lock.cjs');
const { getWakeBridgeNotice } = require('../lib/ui/wake-bridge-copy.cjs');

const fakeDocument = { body: { style: { overflow: 'scroll' } } };
const restore = lockDocumentScroll(fakeDocument);
assert.equal(fakeDocument.body.style.overflow, 'hidden', 'opening settings must lock dashboard scrolling');
restore();
assert.equal(fakeDocument.body.style.overflow, 'scroll', 'closing settings must restore the previous scroll mode');

assert.equal(getWakeBridgeNotice('unconfigured', 'RU'), null, 'technical relay setup copy must not be shown');
assert.equal(getWakeBridgeNotice('unconfigured', 'EN'), null, 'technical relay setup copy must not be shown');

console.log('Settings modal behavior tests passed.');

