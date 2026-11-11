const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

function createIncomingFileTransfers({ transfers, createPath, sanitizeName, decodeChunk, notify = () => {}, io = fs }) {
  const queues = new WeakMap();
  const counts = new WeakMap();
  const connected = ws => ws.readyState === 1 && ws.isAuth === true;
  const reply = (ws, message) => { if (connected(ws)) ws.send(JSON.stringify(message)); };

  async function abort(fileId, removePartial = true) {
    const transfer = transfers.get(fileId);
    if (!transfer) return;
    transfers.delete(fileId);
    transfer.cancelled = true;
    await transfer.pending?.catch(() => {});
    await transfer.handle?.close().catch(() => {});
    transfer.handle = null;
    if (removePartial && transfer.filePath) {
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await io.unlink(transfer.filePath); break; }
        catch (error) {
          if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt === 3) break;
          await delay(100 * (attempt + 1));
        }
      }
    }
  }

  async function process(ws, data) {
    if (!connected(ws)) return;
    const action = data.action;
    const fileId = String(data.fileId || (action === 'FILE_START' ? crypto.randomUUID() : ''));
    const ack = `${action}_ACK`;
    if (action === 'FILE_START') {
      const fileSize = Number(data.fileSize);
      if (!/^[a-zA-Z0-9._-]{1,128}$/.test(fileId) || transfers.has(fileId) ||
          !Number.isSafeInteger(fileSize) || fileSize < 0 || fileSize > 500 * 1024 * 1024 ||
          [...transfers.values()].filter(item => item.ws === ws).length >= 5) {
        reply(ws, { action: ack, fileId, status: 'ERROR', error: 'Invalid or duplicate file transfer' });
        return;
      }
      const chunkSize = Number(data.chunkSize || 64 * 1024);
      const transfer = { fileId, fileName: sanitizeName(data.fileName), fileSize, ws, handle: null,
        chunkSize: Number.isSafeInteger(chunkSize) && chunkSize > 0 && chunkSize <= 256 * 1024 ? chunkSize : 64 * 1024,
        receivedBytes: 0, currentOffset: 0, lastActivity: Date.now(), cancelled: false };
      transfers.set(fileId, transfer);
      try {
        for (let attempt = 0; attempt < 1000 && !transfer.cancelled; attempt++) {
          const target = createPath(transfer.fileName);
          try {
            transfer.pending = io.open(target, 'wx').then(handle => {
              if (transfer.cancelled) {
                handle.close().catch(() => {});
                return;
              }
              transfer.handle = handle;
              transfer.filePath = target;
            });
            await transfer.pending;
            if (transfer.handle) break;
          } catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
        if (transfer.cancelled) {
          await abort(fileId);
          return;
        }
        if (!transfer.handle) throw new Error('No destination available');
        reply(ws, { action: ack, fileId, status: 'SUCCESS' });
      } catch (_) {
        await abort(fileId);
        reply(ws, { action: ack, fileId, status: 'ERROR', error: 'Failed to create file' });
      }
      return;
    }
    const transfer = transfers.get(fileId);
    if (!transfer || transfer.ws !== ws || transfer.cancelled) {
      if (action !== 'FILE_CANCEL') reply(ws, { action: ack, fileId, status: 'ERROR', error: 'Unknown file transfer' });
      return;
    }
    if (action === 'FILE_CANCEL') {
      await abort(fileId);
      if (ws.readyState === 1) {
        reply(ws, { action: ack, fileId, status: 'SUCCESS' });
      }
      return;
    }
    transfer.lastActivity = Date.now();
    try {
      if (action === 'FILE_CHUNK') {
        const bytes = decodeChunk(data.data || data.chunk || data.base64);
        const offset = Number.isSafeInteger(data.offset) ? data.offset :
          Number.isSafeInteger(data.chunkIndex) ? data.chunkIndex * transfer.chunkSize : transfer.currentOffset;
        if (!bytes || !bytes.length || bytes.length > transfer.chunkSize || offset !== transfer.currentOffset ||
            offset < 0 || offset + bytes.length > transfer.fileSize) throw new Error('Invalid chunk');
        transfer.pending = (async () => {
          let written = 0;
          while (written < bytes.length && !transfer.cancelled) {
            const result = await transfer.handle.write(bytes, written, bytes.length - written, offset + written);
            if (result.bytesWritten < 1) throw new Error('Incomplete write');
            written += result.bytesWritten;
          }
        })();
        await transfer.pending;
        if (transfer.cancelled) return;
        transfer.currentOffset = offset + bytes.length;
        transfer.receivedBytes = transfer.currentOffset;
        reply(ws, { action: ack, fileId, chunkIndex: data.chunkIndex, status: 'SUCCESS', receivedBytes: transfer.receivedBytes });
      } else if (action === 'FILE_END') {
        if (transfer.receivedBytes !== transfer.fileSize) throw new Error('Incomplete file');
        transfer.pending = transfer.handle.sync();
        await transfer.pending;
        if (transfer.cancelled) return;
        transfer.pending = transfer.handle.close();
        await transfer.pending;
        transfer.handle = null;
        if (transfer.cancelled) return;
        const savedFileName = transfer.filePath ? path.basename(transfer.filePath) : transfer.fileName;
        transfers.delete(fileId);
        notify({ ...transfer, fileName: savedFileName });
        reply(ws, { action: ack, fileId, fileName: savedFileName, status: 'SUCCESS' });
      }
    } catch (_) {
      await abort(fileId);
      reply(ws, { action: ack, fileId, status: 'ERROR', error: 'Failed to receive file' });
    }
  }

  function handle(ws, data) {
    const queued = counts.get(ws) || 0;
    if (queued >= 32) { ws.close(1008, 'File queue limit'); return Promise.resolve(); }
    counts.set(ws, queued + 1);
    const operation = (queues.get(ws) || Promise.resolve()).catch(() => {}).then(() => process(ws, data));
    queues.set(ws, operation);
    return operation.finally(() => {
      counts.set(ws, (counts.get(ws) || 1) - 1);
      if (queues.get(ws) === operation) queues.delete(ws);
    });
  }
  return { handle, abort };
}

module.exports = { createIncomingFileTransfers };
