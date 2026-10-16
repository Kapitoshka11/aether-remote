const assert = require('node:assert/strict');
const {
  abortOutgoingRendererTransfers,
  awaitOutgoingFileAck,
  handleOutgoingFileAck,
  handleOutgoingClientClosed
} = require('../lib/outgoing-renderer-transfers.cjs');

const sent = [];
let rejection;
const transfers = new Map([['transfer-1', {
  clients: [{ readyState: 1, isAuth: true, send: raw => sent.push(JSON.parse(raw)) }],
  pendingAck: { reject: error => { rejection = error; } }
}]]);

abortOutgoingRendererTransfers(transfers, 'Renderer process terminated');
assert.equal(transfers.size, 0);
assert.equal(rejection.message, 'Renderer process terminated');
assert.deepEqual(sent, [{ action: 'FILE_CANCEL', fileId: 'transfer-1' }]);

function client(name) {
  return { name, readyState: 1, isAuth: true, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
}

(async () => {
  const first = client('first'), second = client('second');
  const transfer = { transferId: 'transfer-2', clients: [first, second], pendingAck: null };
  const transfers = new Map([[transfer.transferId, transfer]]);
  const waiting = awaitOutgoingFileAck(transfer, 'FILE_START_ACK', JSON.stringify({ action: 'FILE_START', fileId: transfer.transferId }), 1000);
  handleOutgoingFileAck(transfers, first, { action: 'FILE_START_ACK', fileId: transfer.transferId, status: 'SUCCESS' });
  await waiting;
  assert.deepEqual(transfer.clients, [first], 'the first accepting phone becomes the sole transfer recipient');
  assert.deepEqual(second.sent.at(-1), { action: 'FILE_CANCEL', fileId: transfer.transferId });

  const rejectFirst = client('reject-first'), acceptSecond = client('accept-second');
  const fallback = { transferId: 'transfer-3', clients: [rejectFirst, acceptSecond], pendingAck: null };
  transfers.set(fallback.transferId, fallback);
  let settled = false;
  const fallbackWaiting = awaitOutgoingFileAck(fallback, 'FILE_START_ACK', JSON.stringify({ action: 'FILE_START', fileId: fallback.transferId }), 1000)
    .finally(() => { settled = true; });
  handleOutgoingFileAck(transfers, rejectFirst, { action: 'FILE_START_ACK', fileId: fallback.transferId, status: 'ERROR', error: 'Declined' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'one rejection must not cancel another phone that can accept');
  handleOutgoingFileAck(transfers, acceptSecond, { action: 'FILE_START_ACK', fileId: fallback.transferId, status: 'SUCCESS' });
  await fallbackWaiting;
  assert.deepEqual(fallback.clients, [acceptSecond]);

  const disconnected = client('disconnected'), remaining = client('remaining');
  const disconnectTransfer = { transferId: 'transfer-4', clients: [disconnected, remaining], pendingAck: null };
  transfers.set(disconnectTransfer.transferId, disconnectTransfer);
  const disconnectWaiting = awaitOutgoingFileAck(disconnectTransfer, 'FILE_START_ACK', JSON.stringify({ action: 'FILE_START', fileId: disconnectTransfer.transferId }), 1000);
  disconnected.readyState = 3;
  handleOutgoingClientClosed(transfers, disconnected);
  handleOutgoingFileAck(transfers, remaining, { action: 'FILE_START_ACK', fileId: disconnectTransfer.transferId, status: 'SUCCESS' });
  await disconnectWaiting;
  assert.deepEqual(disconnectTransfer.clients, [remaining]);

  console.log('Outgoing renderer transfer lifecycle and single-recipient selection tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
