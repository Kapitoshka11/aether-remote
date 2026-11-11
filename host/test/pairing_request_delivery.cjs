const assert = require('node:assert/strict');
const { presentPairingRequest } = require('../lib/ui/pairing-request.cjs');

function windowMock(loading) {
  const calls = [];
  let didFinishLoad = null;
  return {
    calls,
    isDestroyed: () => false,
    isMinimized: () => true,
    isVisible: () => false,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
    webContents: {
      isLoadingMainFrame: () => loading,
      send: (channel, payload) => calls.push([channel, payload]),
      once: (event, listener) => { assert.equal(event, 'did-finish-load'); didFinishLoad = listener; },
      removeListener: (event, listener) => {
        if (event === 'did-finish-load' && didFinishLoad === listener) didFinishLoad = null;
      }
    },
    finishLoading: () => didFinishLoad?.()
  };
}

const pendingWindow = windowMock(true);
const cancelPending = presentPairingRequest(pendingWindow, { requestId: 'one' }, () => true);
assert.deepEqual(pendingWindow.calls, ['restore', 'show', 'focus']);
pendingWindow.finishLoading();
assert.deepEqual(pendingWindow.calls[3], ['pairing-request', { requestId: 'one' }]);
cancelPending();

const readyWindow = windowMock(false);
presentPairingRequest(readyWindow, { requestId: 'two' }, () => true);
assert.deepEqual(readyWindow.calls, ['restore', 'show', 'focus', ['pairing-request', { requestId: 'two' }]]);

const cancelledWindow = windowMock(true);
const cancelBeforeLoad = presentPairingRequest(cancelledWindow, { requestId: 'three' }, () => true);
cancelBeforeLoad();
cancelledWindow.finishLoading();
assert.equal(cancelledWindow.calls.some(Array.isArray), false);

console.log('Pairing request delivery tests passed.');
