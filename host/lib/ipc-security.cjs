const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isTrustedRendererEvent(event, mainWindow, entryPath) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (event?.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'file:' && path.resolve(fileURLToPath(url)) === path.resolve(entryPath);
  } catch (_) {
    return false;
  }
}

function createTrustedIpcRegistrar({ ipcMain, getMainWindow, entryPath, logger = console }) {
  return {
    registerTrustedHandle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedRendererEvent(event, getMainWindow(), entryPath)) throw new Error('IPC request denied');
        return handler(event, ...args);
      });
    },
    registerTrustedOn(channel, listener) {
      ipcMain.on(channel, (event, ...args) => {
        if (!isTrustedRendererEvent(event, getMainWindow(), entryPath)) {
          logger.warn(`[SECURITY] Rejected untrusted IPC message on ${channel}`);
          return;
        }
        listener(event, ...args);
      });
    }
  };
}

module.exports = { createTrustedIpcRegistrar, isTrustedRendererEvent };
