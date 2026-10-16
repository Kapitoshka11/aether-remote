function presentPairingRequest(mainWindow, payload, isPending = () => true) {
  if (!mainWindow || mainWindow.isDestroyed()) return () => {};

  let cancelled = false;
  const send = () => {
    if (cancelled || !isPending() || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('pairing-request', payload);
  };

  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();

  if (mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }

  return () => {
    cancelled = true;
    mainWindow.webContents.removeListener('did-finish-load', send);
  };
}

module.exports = { presentPairingRequest };
