const VALID_RESOLUTIONS = new Set(['1080p', '720p', '480p']);

function applyStreamPreferences(state, request) {
  if (Object.prototype.hasOwnProperty.call(request, 'quality')) {
    const requestedQuality = Number(request.quality);
    if (Number.isFinite(requestedQuality)) {
      state.streamQuality = Math.min(100, Math.max(10, Math.round(requestedQuality)));
    }
  }
  if (Object.prototype.hasOwnProperty.call(request, 'resolution') && VALID_RESOLUTIONS.has(request.resolution)) {
    state.streamResolution = request.resolution;
  }
  return state;
}

function recordFrameDispatch(state, now = Date.now()) {
  state.nextFrameId = Number.isSafeInteger(state.nextFrameId) ? state.nextFrameId + 1 : 1;
  state.frameSentAtById ||= new Map();
  state.frameSentAtById.set(state.nextFrameId, now);
  while (state.frameSentAtById.size > 120) {
    state.frameSentAtById.delete(state.frameSentAtById.keys().next().value);
  }
  state.lastFrameSentAt = now;
  return { frameId: state.nextFrameId, sentAt: now };
}

function resolveFrameSentAt(state, acknowledgement) {
  const frameId = Number.isSafeInteger(acknowledgement?.frameId) ? acknowledgement.frameId : null;
  if (frameId !== null) {
    const sentAt = state.frameSentAtById?.get(frameId);
    state.frameSentAtById?.delete(frameId);
    return sentAt ?? null;
  }
  return Number.isFinite(acknowledgement?.sentAt)
    ? acknowledgement.sentAt
    : (Number.isFinite(state.lastFrameSentAt) ? state.lastFrameSentAt : null);
}

module.exports = { applyStreamPreferences, recordFrameDispatch, resolveFrameSentAt };
