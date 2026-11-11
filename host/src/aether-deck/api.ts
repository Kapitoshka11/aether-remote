import type { DeckDocument, ProviderDescription } from './types';
import { getDesktopBridge } from '../platform/desktopBridge';

function ipc() {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error('Редактор доступен только в приложении Aether Remote');
  return bridge;
}

export const deckApi = {
  getDocument: (): Promise<DeckDocument> => ipc().invoke('aether-deck:get-document'),
  getProviders: (): Promise<ProviderDescription[]> => ipc().invoke('aether-deck:get-providers'),
  saveDocument: (document: DeckDocument): Promise<DeckDocument> => ipc().invoke('aether-deck:save-document', document),
  selectAsset: (): Promise<{ canceled: boolean; asset?: { hash: string; mimeType: string; size: number; fileName: string } }> => ipc().invoke('aether-deck:select-asset'),
  selectApplication: (): Promise<{ canceled: boolean; path?: string }> => ipc().invoke('aether-deck:select-application'),
  exportDeck: (): Promise<{ canceled: boolean; path?: string }> => ipc().invoke('aether-deck:export'),
  importDeck: (): Promise<{ canceled: boolean; document?: DeckDocument }> => ipc().invoke('aether-deck:import'),
  getObsSettings: (): Promise<{ url: string; connected: boolean }> => ipc().invoke('aether-deck:get-obs-settings'),
  setObsSettings: (settings: { url: string; password: string }): Promise<{ url: string; connected: boolean }> => ipc().invoke('aether-deck:set-obs-settings', settings)
};
