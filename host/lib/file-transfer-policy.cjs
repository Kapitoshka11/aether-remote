function countOwnedTransfers(transfers, owner) {
  return [...transfers.values()].filter(transfer => transfer.ws === owner).length;
}

function incomingTransferTimeoutMs(transfer) {
  return transfer.receivedBytes === 0 ? 10_000 : 45_000;
}

function outgoingFileAckTimeoutMs(action) {
  return action === 'FILE_START_ACK' ? 30_000 : 10_000;
}

const OUTGOING_TRANSFER_TIMEOUT_MS = 45_000;

module.exports = { countOwnedTransfers, incomingTransferTimeoutMs, outgoingFileAckTimeoutMs, OUTGOING_TRANSFER_TIMEOUT_MS };
