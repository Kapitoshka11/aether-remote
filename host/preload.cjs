const { contextBridge, ipcRenderer } = require('electron');

const allowedSendChannels = new Set([
  'set-autostart',
  'set-minimize-to-tray',
  'pairing-response',
  'audio-pcm-chunk',
  'audio-capture-status',
  'force-disconnect-client',
  'update-p2p-connections-count'
]);

const allowedInvokeChannels = new Set([
  'account:get-state',
  'account:action',
  'get-system-info',
  'get-approved-tokens',
  'get-clipboard-sharing',
  'set-clipboard-sharing',
  'revoke-token',
  'open-download-folder',
  'get-download-folder',
  'select-download-folder',
  'send-file-start',
  'send-file-chunk-data',
  'send-file-end',
  'send-file-cancel',
  'aether-deck:get-document',
  'aether-deck:save-document',
  'aether-deck:get-providers',
  'aether-deck:select-asset',
  'aether-deck:select-application',
  'aether-deck:export',
  'aether-deck:import',
  'aether-deck:get-obs-settings',
  'aether-deck:set-obs-settings'
  ,'wake-bridge:get-status'
  ,'wake-bridge:set-enabled'
  ,'wake-bridge:revoke-member'
  ,'wake-bridge:add-target'
]);

const allowedReceiveChannels = new Set([
  'account-state',
  'hardware-info-updated',
  'telemetry-update',
  'pairing-request',
  'pairing-cancel',
  'tokens-updated',
  'audio-capture-toggle',
  'force-disconnect-p2p',
  'file-received',
  'server-error'
  ,'wake-bridge-status'
]);

const wrappedListeners = new WeakMap();
const ipcFacade = Object.freeze({
  send(channel, ...args) {
    if (!allowedSendChannels.has(channel)) throw new Error(`IPC send channel is not allowed: ${channel}`);
    ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (!allowedInvokeChannels.has(channel)) return Promise.reject(new Error(`IPC invoke channel is not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!allowedReceiveChannels.has(channel) || typeof listener !== 'function') throw new Error(`IPC receive channel is not allowed: ${channel}`);
    const wrapped = (event, ...args) => listener({ senderId: event.senderId }, ...args);
    let channelMap = wrappedListeners.get(listener);
    if (!channelMap) {
      channelMap = new Map();
      wrappedListeners.set(listener, channelMap);
    }
    channelMap.set(channel, wrapped);
    ipcRenderer.on(channel, wrapped);
    return ipcFacade;
  },
  removeListener(channel, listener) {
    const wrapped = wrappedListeners.get(listener)?.get(channel);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      wrappedListeners.get(listener).delete(channel);
    }
    return ipcFacade;
  }
});

contextBridge.exposeInMainWorld('require', (moduleName) => {
  if (moduleName !== 'electron') throw new Error(`Module is not available in renderer: ${String(moduleName)}`);
  return Object.freeze({ ipcRenderer: ipcFacade });
});
