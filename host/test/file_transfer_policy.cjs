const assert = require('node:assert/strict');
const { countOwnedTransfers, incomingTransferTimeoutMs, outgoingFileAckTimeoutMs, OUTGOING_TRANSFER_TIMEOUT_MS } = require('../lib/file-transfer-policy.cjs');

const first = {};
const second = {};
const transfers = new Map([
  ['a', { ws: first, receivedBytes: 0 }],
  ['b', { ws: first, receivedBytes: 1 }],
  ['c', { ws: second, receivedBytes: 0 }],
]);

assert.equal(countOwnedTransfers(transfers, first), 2);
assert.equal(countOwnedTransfers(transfers, second), 1);
assert.equal(incomingTransferTimeoutMs(transfers.get('a')), 10_000);
assert.equal(incomingTransferTimeoutMs(transfers.get('b')), 45_000);
assert.equal(outgoingFileAckTimeoutMs('FILE_START_ACK'), 30_000);
assert.equal(outgoingFileAckTimeoutMs('FILE_CHUNK_ACK'), 10_000);
assert.equal(OUTGOING_TRANSFER_TIMEOUT_MS, 45_000);
console.log('File transfer policy tests passed.');
