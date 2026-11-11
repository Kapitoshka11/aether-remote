function authenticatedClients(transfer) {
  return (transfer.clients || []).filter(client => client.readyState === 1 && client.isAuth);
}

function settlePending(transfer, method, value) {
  const pending = transfer.pendingAck;
  if (!pending) return;
  clearTimeout(pending.timer);
  transfer.pendingAck = null;
  pending[`${method}Promise`](value);
}

function awaitOutgoingFileAck(transfer, expectedAction, message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    transfer.clients = authenticatedClients(transfer);
    if (transfer.clients.length === 0) {
      reject(new Error('No authenticated mobile client is connected'));
      return;
    }
    if (transfer.pendingAck) {
      reject(new Error('Another file packet is still awaiting acknowledgement'));
      return;
    }
    const pending = {
      expectedAction,
      awaiting: new Set(transfer.clients),
      resolvePromise: resolve,
      rejectPromise: reject,
      resolve: value => settlePending(transfer, 'resolve', value),
      reject: error => settlePending(transfer, 'reject', error instanceof Error ? error : new Error(String(error))),
      timer: null
    };
    pending.timer = setTimeout(() => {
      if (transfer.pendingAck === pending) settlePending(transfer, 'reject', new Error(`Timed out waiting for ${expectedAction}`));
    }, timeoutMs);
    transfer.pendingAck = pending;
    try {
      transfer.clients.forEach(client => client.send(message));
    } catch (error) {
      settlePending(transfer, 'reject', error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function handleOutgoingFileAck(transfers, ws, data) {
  const transfer = transfers.get(String(data.fileId || ''));
  const pending = transfer && transfer.pendingAck;
  if (!pending || pending.expectedAction !== data.action || !pending.awaiting.has(ws)) return;

  if (pending.expectedAction === 'FILE_START_ACK') {
    pending.awaiting.delete(ws);
    if (data.status === 'SUCCESS') {
      const cancellation = JSON.stringify({ action: 'FILE_CANCEL', fileId: transfer.transferId || String(data.fileId || '') });
      for (const client of transfer.clients) {
        if (client !== ws && client.readyState === 1 && client.isAuth) client.send(cancellation);
      }
      transfer.clients = [ws];
      settlePending(transfer, 'resolve', data);
      return;
    }
    transfer.clients = transfer.clients.filter(client => client !== ws);
    if (pending.awaiting.size === 0) {
      settlePending(transfer, 'reject', new Error(String(data.error || 'All mobile clients rejected FILE_START')));
    }
    return;
  }

  if (data.status !== 'SUCCESS') {
    settlePending(transfer, 'reject', new Error(String(data.error || `Mobile client rejected ${data.action}`)));
    return;
  }
  pending.awaiting.delete(ws);
  if (pending.awaiting.size === 0) settlePending(transfer, 'resolve', data);
}

function handleOutgoingClientClosed(transfers, ws) {
  for (const [fileId, transfer] of transfers.entries()) {
    const pending = transfer.pendingAck;
    transfer.clients = (transfer.clients || []).filter(client => client !== ws);
    if (pending?.awaiting.has(ws)) {
      pending.awaiting.delete(ws);
      if (pending.awaiting.size === 0) {
        settlePending(transfer, 'reject', new Error('Mobile client disconnected during file transfer'));
      }
    }
    if (transfer.clients.length === 0 && !transfer.pendingAck) transfers.delete(fileId);
  }
}

function abortOutgoingRendererTransfers(transfers, reason = 'Renderer unavailable') {
  for (const [fileId, transfer] of transfers.entries()) {
    if (transfer.pendingAck) transfer.pendingAck.reject(new Error(reason));
    const message = JSON.stringify({ action: 'FILE_CANCEL', fileId });
    for (const client of transfer.clients || []) {
      if (client.readyState === 1 && client.isAuth) client.send(message);
    }
    transfers.delete(fileId);
  }
}

module.exports = {
  abortOutgoingRendererTransfers,
  awaitOutgoingFileAck,
  handleOutgoingFileAck,
  handleOutgoingClientClosed
};
