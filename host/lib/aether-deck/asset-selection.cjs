async function selectDeckAsset({ showOpenDialog, assetStore }) {
  const result = await showOpenDialog();
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const asset = await assetStore.importFile(result.filePaths[0]);
  return {
    canceled: false,
    asset: {
      hash: asset.hash,
      mimeType: asset.mimeType,
      size: asset.size,
      fileName: asset.fileName
    }
  };
}

module.exports = { selectDeckAsset };
