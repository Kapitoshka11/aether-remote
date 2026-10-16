const ALLOWED_ACTIONS = new Set([
  'ACCOUNT_HELLO', 'ACCOUNT_PROOF',
  'AUTH', 'PING', 'GET_TELEMETRY', 'STREAM_FRAME', 'FRAME_ACK', 'AUDIO_STREAM',
  'FILE_START', 'FILE_CHUNK', 'FILE_END', 'FILE_CANCEL',
  'FILE_START_ACK', 'FILE_CHUNK_ACK', 'FILE_END_ACK',
  'KILL_PROCESS', 'SEND_TOAST', 'POWER', 'MEDIA', 'CLIPBOARD', 'WRITE_CLIPBOARD',
  'SYSTEM', 'KEY_PRESS', 'MOUSE_MOVE', 'MOUSE_CLICK', 'MOUSE_SCROLL',
  'REMOTE_KEY_PRESS', 'REMOTE_MOUSE_MOVE', 'REMOTE_MOUSE_CLICK', 'REMOTE_MOUSE_SCROLL',
  'TAKE_SCREENSHOT', 'WAKE_ENROLL',
  'DECK_SYNC_REQUEST', 'DECK_TRIGGER', 'DECK_SLIDER', 'DECK_NAVIGATE', 'DECK_ASSET_REQUEST'
]);

function boundedString(value, max) {
  return value === undefined || (typeof value === 'string' && value.length <= max);
}

function finiteNumber(value) {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

function clipboardWriteText(data) {
  return typeof data?.text === 'string' ? data.text : '';
}

function validateInboundMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Invalid message' };
  if (Object.keys(data).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) return { ok: false, error: 'Invalid field' };
  if (typeof data.action !== 'string' || !ALLOWED_ACTIONS.has(data.action)) return { ok: false, error: 'Unsupported action' };
  if (!boundedString(data.command, 100_000) || !boundedString(data.text, 100_000) || !boundedString(data.message, 100_000)) {
    return { ok: false, error: 'Text field is too large' };
  }
  if (!boundedString(data.fileId, 128) || !boundedString(data.fileName, 255)) return { ok: false, error: 'Invalid file metadata' };
  if (!finiteNumber(data.fileSize) || !finiteNumber(data.chunkSize) || !finiteNumber(data.offset) || !finiteNumber(data.chunkIndex)) {
    return { ok: false, error: 'Invalid numeric field' };
  }
  if (data.fileSize !== undefined && (!Number.isSafeInteger(data.fileSize) || data.fileSize < 0 || data.fileSize > 500 * 1024 * 1024)) return { ok: false, error: 'Invalid file size' };
  if (data.chunkSize !== undefined && (!Number.isSafeInteger(data.chunkSize) || data.chunkSize < 1 || data.chunkSize > 256 * 1024)) return { ok: false, error: 'Invalid chunk size' };
  if (data.offset !== undefined && (!Number.isSafeInteger(data.offset) || data.offset < 0)) return { ok: false, error: 'Invalid file offset' };
  if (data.chunkIndex !== undefined && (!Number.isSafeInteger(data.chunkIndex) || data.chunkIndex < 0)) return { ok: false, error: 'Invalid chunk index' };
  if (!boundedString(data.data, 350_000) || !boundedString(data.chunk, 350_000) || !boundedString(data.base64, 350_000)) return { ok: false, error: 'Invalid file chunk' };
  if (data.action === 'AUTH') {
    if (!boundedString(data.pin, 32) || !boundedString(data.sessionToken, 128) || !boundedString(data.deviceModel, 80)) {
      return { ok: false, error: 'Invalid authentication request' };
    }
    if (data.capabilities !== undefined && (!Array.isArray(data.capabilities) || data.capabilities.length > 32 || data.capabilities.some(item => typeof item !== 'string' || item.length > 64))) {
      return { ok: false, error: 'Invalid capabilities' };
    }
  }
  if (data.action.startsWith('ACCOUNT_')) {
    if (!boundedString(data.accessToken, 16384) || !boundedString(data.signature, 100) ||
        !['ownerId', 'sessionId', 'grantId'].every(key => boundedString(data[key], 36)) ||
        !['hostId', 'phoneId'].every(key => boundedString(data[key], 64)) || !boundedString(data.nonce, 43) ||
        !boundedString(data.transport, 5) || (data.expiresAt !== undefined && !Number.isSafeInteger(data.expiresAt)) ||
        (data.capabilities !== undefined && (!Array.isArray(data.capabilities) || data.capabilities.length > 32 ||
          data.capabilities.some(item => typeof item !== 'string' || item.length > 64)))) return { ok: false, error: 'Invalid account request' };
  }
  if (data.action === 'SEND_TOAST' && (!boundedString(data.title, 128) || !boundedString(data.text, 1000) || !boundedString(data.message, 1000))) {
    return { ok: false, error: 'Notification text is too large' };
  }
  if (data.action === 'WAKE_ENROLL' && (!boundedString(data.deviceId, 32) || !boundedString(data.publicKeySpki, 2048))) return { ok: false, error: 'Invalid enrollment request' };
  if (data.action.startsWith('DECK_') && (!boundedString(data.controlId, 128) || !boundedString(data.pageId, 128) || !boundedString(data.assetId, 128))) return { ok: false, error: 'Invalid Deck request' };
  if (data.action === 'DECK_SLIDER' && (typeof data.triggerId !== 'string' ||
      [...data.triggerId].length < 1 || [...data.triggerId].length > 128)) return { ok: false, error: 'Invalid slider triggerId' };
  return { ok: true };
}

module.exports = { ALLOWED_ACTIONS, clipboardWriteText, validateInboundMessage };
